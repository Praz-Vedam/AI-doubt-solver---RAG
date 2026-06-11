import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import wavefile from "wavefile";

const { WaveFile } = wavefile as typeof wavefile & {
  WaveFile: new (buffer: Buffer) => {
    toBitDepth: (bitDepth: string) => void;
    toSampleRate: (sampleRate: number) => void;
    getSamples: (
      interleaved?: boolean,
      outputFormat?: Float32ArrayConstructor,
    ) => Float32Array | Float32Array[];
  };
};

const execFileAsync = promisify(execFile);

export async function ensureFfmpegAvailable(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new Error(
      "ffmpeg is not installed or not available on PATH. Install ffmpeg to extract audio from videos.",
    );
  }
}

export async function extractAudio(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  await ensureFfmpegAvailable();
  await execFileAsync("ffmpeg", [
    "-y",
    "-nostats",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ]);
  await access(outputPath);
  return outputPath;
}

// 16kHz mono AAC @32kbps: a 2h video yields ~30MB instead of a ~230MB WAV,
// which is what makes chunked Whisper API uploads feasible.
export async function extractCompressedAudio(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  await ensureFfmpegAvailable();
  await execFileAsync("ffmpeg", [
    "-y",
    "-nostats",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "32k",
    outputPath,
  ]);
  await access(outputPath);
  return outputPath;
}

// Midpoints of detected silences, used to cut chunks between words/sentences
// instead of mid-speech (mid-speech cuts degrade Whisper accuracy at boundaries).
export async function detectSilencePoints(inputPath: string): Promise<number[]> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-i", inputPath, "-af", "silencedetect=noise=-35dB:d=0.5", "-f", "null", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    const points: number[] = [];
    let lastStart: number | null = null;

    for (const line of stderr.split("\n")) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        lastStart = Number.parseFloat(startMatch[1]);
        continue;
      }
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (endMatch && lastStart !== null) {
        const end = Number.parseFloat(endMatch[1]);
        points.push((lastStart + end) / 2);
        lastStart = null;
      }
    }

    return points;
  } catch {
    return [];
  }
}

export type AudioChunkPlan = {
  start: number;
  duration: number;
};

export function planAudioChunks(
  durationSec: number,
  silencePoints: number[],
  targetChunkSec: number,
  toleranceSec = 90,
): AudioChunkPlan[] {
  const chunks: AudioChunkPlan[] = [];
  let cursor = 0;

  while (durationSec - cursor > targetChunkSec + toleranceSec) {
    const ideal = cursor + targetChunkSec;
    const candidates = silencePoints.filter(
      (point) => point > cursor + toleranceSec && Math.abs(point - ideal) <= toleranceSec,
    );
    const cut = candidates.length
      ? candidates.reduce((best, point) =>
          Math.abs(point - ideal) < Math.abs(best - ideal) ? point : best,
        )
      : ideal;

    chunks.push({ start: cursor, duration: cut - cursor });
    cursor = cut;
  }

  chunks.push({ start: cursor, duration: durationSec - cursor });
  return chunks.filter((chunk) => chunk.duration > 0.5);
}

export async function cutAudioChunk(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
): Promise<string> {
  // Stream copy (no re-encode): packet-accurate cuts are good enough for
  // audio-only AAC and keep chunking nearly instant.
  await execFileAsync("ffmpeg", [
    "-y",
    "-nostats",
    "-loglevel",
    "error",
    "-ss",
    startSec.toFixed(3),
    "-t",
    durationSec.toFixed(3),
    "-i",
    inputPath,
    "-c",
    "copy",
    outputPath,
  ]);
  await access(outputPath);
  return outputPath;
}

export async function getMediaDuration(inputPath: string): Promise<number | null> {
  try {
    await ensureFfmpegAvailable();
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

export function getAudioPathForVideo(videoFilename: string): string {
  const base = path.parse(videoFilename).name;
  return path.join(path.dirname(videoFilename), `${base}.wav`);
}

export function getCompressedAudioPathForVideo(videoFilename: string): string {
  const base = path.parse(videoFilename).name;
  return path.join(path.dirname(videoFilename), `${base}.m4a`);
}

export function getVideoStoragePath(filename: string, uploadDir: string): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), uploadDir, filename);
}

export async function loadWavSamples(audioPath: string): Promise<Float32Array> {
  const buffer = await readFile(audioPath);
  const wav = new WaveFile(buffer);

  wav.toBitDepth("32f");
  wav.toSampleRate(16000);

  let audioData = wav.getSamples(false, Float32Array);
  if (Array.isArray(audioData)) {
    if (audioData.length > 1) {
      const scalingFactor = Math.sqrt(2);
      for (let i = 0; i < audioData[0].length; i += 1) {
        audioData[0][i] = (scalingFactor * (audioData[0][i] + audioData[1][i])) / 2;
      }
    }
    audioData = audioData[0];
  }

  // wavefile's typings don't admit Float64Array, but it can occur at runtime.
  const samples: unknown = audioData;

  if (samples instanceof Float64Array) {
    return Float32Array.from(samples);
  }

  if (!(samples instanceof Float32Array)) {
    throw new Error("Failed to decode audio into Float32Array samples");
  }

  return samples;
}
