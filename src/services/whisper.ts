import path from "node:path";
import { readFile, rm, stat } from "node:fs/promises";
import {
  cutAudioChunk,
  detectSilencePoints,
  getMediaDuration,
  loadWavSamples,
  planAudioChunks,
} from "@/services/audio";
import type { TranscriptSegment } from "@/types";

// OpenAI's hard limit is 25MB per file; stay under it with headroom.
const OPENAI_MAX_FILE_BYTES = 24 * 1024 * 1024;

function getChunkTargetSeconds(): number {
  const parsed = Number(process.env.WHISPER_CHUNK_SECONDS);
  return Number.isFinite(parsed) && parsed >= 60 ? parsed : 600;
}

function getWhisperConcurrency(): number {
  const parsed = Number(process.env.WHISPER_CONCURRENCY);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 4;
}

function getHostedWhisperConcurrency(): number {
  const parsed = Number(process.env.WHISPER_CONCURRENCY);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  // Remote GPU boxes often die when several long chunks are sent in parallel.
  return 1;
}

const HOSTED_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const HOSTED_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatHostedWhisperError(status: number, responseText: string): string {
  const trimmed = responseText.trim();

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    const ngrokCode = trimmed.match(/ERR_NGROK_\d+/)?.[0];
    const noscript = trimmed.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1]?.replace(/\s+/g, " ").trim();
    const hint =
      "Check that your Whisper server and ngrok tunnel are running. For long videos, set WHISPER_CONCURRENCY=1 or use WHISPER_PROVIDER=openai.";
    const code = ngrokCode ? `, ${ngrokCode}` : "";
    const detail = noscript ? `: ${noscript}` : "";
    return `Hosted Whisper tunnel/backend unavailable (${status}${code})${detail}. ${hint}`;
  }

  if (trimmed.length > 300) {
    return `Hosted Whisper failed (${status}): ${trimmed.slice(0, 300)}…`;
  }

  return `Hosted Whisper failed (${status}): ${trimmed || "Unknown error"}`;
}

type WhisperChunk = {
  timestamp?: [number, number | null];
  text?: string;
};

type WhisperOutput = {
  text?: string;
  chunks?: WhisperChunk[];
};

type LocalTranscriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<WhisperOutput>;

let transcriberPromise: Promise<LocalTranscriber> | null = null;

async function getLocalTranscriber(): Promise<LocalTranscriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const transformers = await import("@huggingface/transformers");
      const model = process.env.WHISPER_MODEL ?? "Xenova/whisper-small.en";
      const createPipeline = transformers.pipeline as (
        task: string,
        modelName: string,
        options?: Record<string, unknown>,
      ) => Promise<LocalTranscriber>;

      return createPipeline("automatic-speech-recognition", model, {
        dtype: "q8",
      });
    })();
  }

  return transcriberPromise;
}

function normalizeLocalOutput(output: WhisperOutput): TranscriptSegment[] {
  if (output.chunks?.length) {
    return output.chunks
      .map((chunk) => {
        const start = chunk.timestamp?.[0] ?? 0;
        const end = chunk.timestamp?.[1] ?? start;
        const text = (chunk.text ?? "").trim();
        if (!text) return null;
        return { start, end: end ?? start, text };
      })
      .filter((segment): segment is TranscriptSegment => segment !== null);
  }

  const text = (output.text ?? "").trim();
  if (!text) return [];
  return [{ start: 0, end: 0, text }];
}

type OpenAIClient = import("openai").default;

async function getOpenAIClient(): Promise<OpenAIClient> {
  const OpenAI = (await import("openai")).default;
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 600_000,
    maxRetries: 2,
  });
}

async function transcribeFileWithOpenAI(
  client: OpenAIClient,
  audioPath: string,
  offsetSec: number,
  prompt?: string,
): Promise<TranscriptSegment[]> {
  const fs = await import("node:fs");
  const file = fs.createReadStream(audioPath);

  const response = await client.audio.transcriptions.create({
    file,
    model: process.env.OPENAI_WHISPER_MODEL ?? "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    ...(prompt ? { prompt } : {}),
  });

  const segments = (response as { segments?: Array<{ start: number; end: number; text: string }> })
    .segments;

  if (!segments?.length) {
    const text = (response as { text?: string }).text?.trim();
    return text ? [{ start: offsetSec, end: offsetSec, text }] : [];
  }

  return segments
    .map((segment) => ({
      start: segment.start + offsetSec,
      end: segment.end + offsetSec,
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text);
}

function transcriptTail(segments: TranscriptSegment[], maxChars = 200): string {
  const text = segments.map((segment) => segment.text).join(" ").trim();
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function getHostedWhisperBaseUrl(): string {
  const baseUrl = process.env.WHISPER_BASE_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("WHISPER_BASE_URL is required when WHISPER_PROVIDER=hosted");
  }
  return baseUrl;
}

function hostedWhisperHeaders(): Record<string, string> {
  return { "ngrok-skip-browser-warning": "true" };
}

function getHostedPollIntervalMs(): number {
  const parsed = Number(process.env.WHISPER_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 500 ? parsed : 3000;
}

function getHostedJobTimeoutMs(): number {
  const parsed = Number(process.env.WHISPER_JOB_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 30_000 ? parsed : 3_600_000;
}

type HostedTranscriptionResponse = {
  text?: string | null;
  status?: string;
  progress_percent?: number;
  filename?: string;
  total_duration_seconds?: number;
  detected_language?: string;
  language_probability?: number;
  error?: string;
  message?: string;
  job_id?: string;
  id?: string;
  check_status_url?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  chunks?: WhisperChunk[];
};

function hostedJobId(data: HostedTranscriptionResponse): string | null {
  return data.job_id ?? data.id ?? null;
}

function hasImmediateHostedTranscript(data: HostedTranscriptionResponse): boolean {
  return Boolean(data.segments?.length || data.chunks?.length || data.text?.trim());
}

function isHostedAsyncJob(data: HostedTranscriptionResponse): boolean {
  if (hasImmediateHostedTranscript(data)) return false;

  const status = (data.status ?? "").toLowerCase();
  return Boolean(
    hostedJobId(data) ||
      data.check_status_url ||
      status === "processing" ||
      status === "queued" ||
      status === "pending",
  );
}

function resolveHostedStatusUrl(baseUrl: string, data: HostedTranscriptionResponse): string {
  const jobId = hostedJobId(data);
  const statusPath =
    data.check_status_url ??
    (jobId ? `${process.env.WHISPER_STATUS_PATH ?? "/status"}/${jobId}` : null);

  if (!statusPath) {
    throw new Error("Hosted Whisper queued a job but returned no status URL");
  }

  return statusPath.startsWith("http") ? statusPath : `${baseUrl}${statusPath}`;
}

function hostedPollMessage(data: HostedTranscriptionResponse): string | undefined {
  const percent = data.progress_percent;
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  const rounded = Math.round(percent);
  if (data.filename) {
    return `Transcribing ${data.filename} (${rounded}%)...`;
  }
  return `Transcribing audio (${rounded}%)...`;
}

async function pollHostedWhisperJob(
  baseUrl: string,
  submit: HostedTranscriptionResponse,
  offsetSec: number,
  onPollProgress?: (percent: number, message?: string) => void,
): Promise<TranscriptSegment[]> {
  const statusUrl = resolveHostedStatusUrl(baseUrl, submit);
  const deadline = Date.now() + getHostedJobTimeoutMs();
  const pollIntervalMs = getHostedPollIntervalMs();

  const reportPollProgress = (data: HostedTranscriptionResponse) => {
    const percent = data.progress_percent;
    if (percent === undefined || !Number.isFinite(percent)) return;
    onPollProgress?.(percent, hostedPollMessage(data));
  };

  reportPollProgress(submit);

  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(statusUrl, { headers: hostedWhisperHeaders() });
    } catch (error) {
      throw new Error(
        `Hosted Whisper status check failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(formatHostedWhisperError(response.status, responseText));
    }

    const data = responseText ? (JSON.parse(responseText) as HostedTranscriptionResponse) : {};
    const status = (data.status ?? "").toLowerCase();

    if (status === "completed" || status === "done" || status === "success") {
      onPollProgress?.(100, hostedPollMessage({ ...data, progress_percent: 100 }));
      const segments = normalizeHostedOutput(data, offsetSec);
      if (!segments.length) {
        throw new Error("Hosted Whisper job completed but returned no transcript text");
      }
      return segments;
    }

    if (status === "failed" || status === "error") {
      throw new Error(
        `Hosted Whisper job failed: ${data.error ?? data.message ?? "unknown error"}`,
      );
    }

    if (status === "processing" || status === "queued" || status === "pending" || !status) {
      reportPollProgress(data);
      await sleep(pollIntervalMs);
      continue;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Hosted Whisper job timed out after ${Math.round(getHostedJobTimeoutMs() / 1000)}s`,
  );
}

function normalizeHostedOutput(
  data: HostedTranscriptionResponse,
  offsetSec: number,
): TranscriptSegment[] {
  if (data.segments?.length) {
    return data.segments
      .map((segment) => ({
        start: segment.start + offsetSec,
        end: segment.end + offsetSec,
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text);
  }

  if (data.chunks?.length) {
    return normalizeLocalOutput({ text: data.text ?? undefined, chunks: data.chunks }).map((segment) => ({
      start: segment.start + offsetSec,
      end: segment.end + offsetSec,
      text: segment.text,
    }));
  }

  const text = (data.text ?? "").trim();
  if (!text) return [];
  return [{ start: offsetSec, end: offsetSec, text }];
}

async function transcribeFileWithHosted(
  audioPath: string,
  offsetSec: number,
  onPollProgress?: (percent: number, message?: string) => void,
): Promise<TranscriptSegment[]> {
  const baseUrl = getHostedWhisperBaseUrl();
  const transcribePath = process.env.WHISPER_TRANSCRIBE_PATH ?? "/transcribe";
  const audioBuffer = await readFile(audioPath);
  const filename = path.basename(audioPath);

  for (let attempt = 0; attempt < HOSTED_MAX_RETRIES; attempt += 1) {
    const formData = new FormData();
    formData.append("file", new File([audioBuffer], filename));

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${transcribePath}`, {
        method: "POST",
        headers: hostedWhisperHeaders(),
        body: formData,
      });
    } catch (error) {
      if (attempt < HOSTED_MAX_RETRIES - 1) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(
        `Hosted Whisper request failed: ${error instanceof Error ? error.message : "network error"}. Check WHISPER_BASE_URL and that ngrok is running.`,
      );
    }

    const responseText = await response.text();
    if (!response.ok) {
      if (HOSTED_RETRYABLE_STATUSES.has(response.status) && attempt < HOSTED_MAX_RETRIES - 1) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(formatHostedWhisperError(response.status, responseText));
    }

    const data = responseText
      ? (JSON.parse(responseText) as HostedTranscriptionResponse)
      : {};

    if (isHostedAsyncJob(data)) {
      return pollHostedWhisperJob(baseUrl, data, offsetSec, onPollProgress);
    }

    const segments = normalizeHostedOutput(data, offsetSec);
    if (!segments.length) {
      throw new Error(
        "Hosted Whisper returned an empty transcript. If your server now queues jobs, ensure it returns job_id and check_status_url.",
      );
    }
    return segments;
  }

  throw new Error("Hosted Whisper failed after retries");
}

export type TranscriptionProgressDetail = {
  percent?: number;
  message?: string;
};

export type TranscriptionProgress = (
  done: number,
  total: number,
  detail?: TranscriptionProgressDetail,
) => void;

async function transcribeWithOpenAI(
  audioPath: string,
  contextPrompt?: string,
  onProgress?: TranscriptionProgress,
): Promise<TranscriptSegment[]> {
  const client = await getOpenAIClient();
  const duration = await getMediaDuration(audioPath);
  const fileSize = (await stat(audioPath)).size;
  const chunkTargetSec = getChunkTargetSeconds();

  const fitsInOneRequest =
    fileSize <= OPENAI_MAX_FILE_BYTES &&
    (duration === null || duration <= chunkTargetSec * 1.5);

  if (fitsInOneRequest) {
    onProgress?.(0, 1);
    const segments = await transcribeFileWithOpenAI(client, audioPath, 0, contextPrompt);
    onProgress?.(1, 1);
    return segments;
  }

  if (duration === null) {
    throw new Error("Audio exceeds the Whisper API file limit and its duration could not be probed for chunking");
  }

  // Long audio: cut at silence boundaries near every chunk target, then
  // transcribe chunks in parallel batches. Each batch is prompted with the
  // tail of the previous batch's transcript so terminology and sentence flow
  // stay consistent across cuts.
  const silencePoints = await detectSilencePoints(audioPath);
  const plans = planAudioChunks(duration, silencePoints, chunkTargetSec);
  const parsed = path.parse(audioPath);
  const chunkPaths: string[] = [];

  try {
    const chunks = await Promise.all(
      plans.map(async (plan, index) => {
        const chunkPath = path.join(parsed.dir, `${parsed.name}.chunk-${index}${parsed.ext}`);
        chunkPaths.push(chunkPath);
        await cutAudioChunk(audioPath, chunkPath, plan.start, plan.duration);
        return { path: chunkPath, offset: plan.start };
      }),
    );

    const concurrency = getWhisperConcurrency();
    const results: TranscriptSegment[][] = [];
    let previousTail = contextPrompt ?? "";
    let completed = 0;
    onProgress?.(0, chunks.length);

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const prompt = previousTail || undefined;

      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          const segments = await transcribeFileWithOpenAI(client, chunk.path, chunk.offset, prompt);
          completed += 1;
          onProgress?.(completed, chunks.length);
          return segments;
        }),
      );

      results.push(...batchResults);
      const lastInBatch = batchResults[batchResults.length - 1];
      if (lastInBatch?.length) {
        previousTail = transcriptTail(lastInBatch);
      }
    }

    return results.flat().sort((a, b) => a.start - b.start);
  } finally {
    await Promise.all(chunkPaths.map((chunkPath) => rm(chunkPath, { force: true })));
  }
}

async function transcribeWithHosted(
  audioPath: string,
  onProgress?: TranscriptionProgress,
): Promise<TranscriptSegment[]> {
  const duration = await getMediaDuration(audioPath);
  const fileSize = (await stat(audioPath)).size;
  const chunkTargetSec = getChunkTargetSeconds();
  const maxFileBytes = Number(process.env.WHISPER_MAX_FILE_BYTES) || OPENAI_MAX_FILE_BYTES;

  const fitsInOneRequest =
    fileSize <= maxFileBytes && (duration === null || duration <= chunkTargetSec * 1.5);

  if (fitsInOneRequest) {
    onProgress?.(0, 1);
    const segments = await transcribeFileWithHosted(audioPath, 0, (percent, message) => {
      onProgress?.(0, 1, { percent, message });
    });
    onProgress?.(1, 1);
    return segments;
  }

  if (duration === null) {
    throw new Error(
      "Audio exceeds the hosted Whisper file limit and its duration could not be probed for chunking",
    );
  }

  const silencePoints = await detectSilencePoints(audioPath);
  const plans = planAudioChunks(duration, silencePoints, chunkTargetSec);
  const parsed = path.parse(audioPath);
  const chunkPaths: string[] = [];

  try {
    const chunks = await Promise.all(
      plans.map(async (plan, index) => {
        const chunkPath = path.join(parsed.dir, `${parsed.name}.chunk-${index}${parsed.ext}`);
        chunkPaths.push(chunkPath);
        await cutAudioChunk(audioPath, chunkPath, plan.start, plan.duration);
        return { path: chunkPath, offset: plan.start };
      }),
    );

    const concurrency = getHostedWhisperConcurrency();
    const results: TranscriptSegment[][] = [];
    let completed = 0;
    onProgress?.(0, chunks.length);

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (chunk, batchOffset) => {
          const chunkIndex = i + batchOffset;
          const segments = await transcribeFileWithHosted(chunk.path, chunk.offset, (percent, message) => {
            const overall = ((chunkIndex + percent / 100) / chunks.length) * 100;
            onProgress?.(chunkIndex, chunks.length, {
              percent: overall,
              message:
                message ?? `Transcribing audio (chunk ${chunkIndex + 1}/${chunks.length})...`,
            });
          });
          completed += 1;
          onProgress?.(completed, chunks.length);
          return segments;
        }),
      );
      results.push(...batchResults);
    }

    return results.flat().sort((a, b) => a.start - b.start);
  } finally {
    await Promise.all(chunkPaths.map((chunkPath) => rm(chunkPath, { force: true })));
  }
}

export async function transcribeAudio(
  audioPath: string,
  options?: { contextPrompt?: string; onProgress?: TranscriptionProgress },
): Promise<TranscriptSegment[]> {
  const provider = process.env.WHISPER_PROVIDER ?? "local";

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when WHISPER_PROVIDER=openai");
    }
    return transcribeWithOpenAI(audioPath, options?.contextPrompt, options?.onProgress);
  }

  if (provider === "hosted") {
    return transcribeWithHosted(audioPath, options?.onProgress);
  }

  const audioData = await loadWavSamples(audioPath);
  const transcriber = await getLocalTranscriber();
  const output = await transcriber(audioData, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  return normalizeLocalOutput(output);
}
