import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  clearIngestionProgress,
  getIngestionProgress,
  setIngestionProgress,
} from "@/lib/progress";
import { getUploadDir, sanitizeFilename } from "@/lib/utils";
import {
  extractAudio,
  extractCompressedAudio,
  getAudioPathForVideo,
  getCompressedAudioPathForVideo,
  getMediaDuration,
  getVideoStoragePath,
} from "@/services/audio";
import { buildTranscriptTree, plainTextToSegments } from "@/services/tree-index";
import { getVideoNodeTree, storeTranscriptTree } from "@/services/tree-store";
import { transcribeAudio } from "@/services/whisper";
import type { TranscriptSegment } from "@/types";

export async function saveUploadedVideo(file: File): Promise<{ videoId: string; filename: string }> {
  const uploadDir = getUploadDir();
  const absoluteUploadDir = path.join(process.cwd(), uploadDir);
  await mkdir(absoluteUploadDir, { recursive: true });

  const safeName = sanitizeFilename(file.name);
  const uniqueName = `${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = path.join(absoluteUploadDir, uniqueName);
  await writeFile(storagePath, buffer);

  const title = path.parse(file.name).name;
  const video = await prisma.video.create({
    data: {
      title,
      filename: uniqueName,
      status: "PENDING",
    },
  });

  return { videoId: video.id, filename: uniqueName };
}

function getSegmentsSidecarPath(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.segments.json`);
}

async function loadPersistedSegments(videoPath: string): Promise<TranscriptSegment[] | null> {
  try {
    const raw = await readFile(getSegmentsSidecarPath(videoPath), "utf8");
    const segments = JSON.parse(raw) as TranscriptSegment[];
    return Array.isArray(segments) && segments.length ? segments : null;
  } catch {
    return null;
  }
}

async function persistSegments(videoPath: string, segments: TranscriptSegment[]): Promise<void> {
  await writeFile(getSegmentsSidecarPath(videoPath), JSON.stringify(segments), "utf8");
}

// Transcription (Whisper) is the expensive step; raw segments are persisted as
// a sidecar JSON so re-indexing (prompt/model changes, retries after an
// indexing failure) never re-pays it.
async function getOrCreateSegments(
  videoId: string,
  videoPath: string,
  title: string,
): Promise<TranscriptSegment[]> {
  const persisted = await loadPersistedSegments(videoPath);
  if (persisted) {
    return persisted;
  }

  const provider = process.env.WHISPER_PROVIDER ?? "local";
  const usesRemoteTranscription = provider === "openai" || provider === "hosted";
  const audioPath = usesRemoteTranscription
    ? getCompressedAudioPathForVideo(videoPath)
    : getAudioPathForVideo(videoPath);

  try {
    setIngestionProgress(videoId, "extracting", "Extracting audio...", 3);
    if (usesRemoteTranscription) {
      await extractCompressedAudio(videoPath, audioPath);
    } else {
      await extractAudio(videoPath, audioPath);
    }

    setIngestionProgress(videoId, "transcribing", "Transcribing...", 10);
    const segments = await transcribeAudio(audioPath, {
      contextPrompt: title,
      onProgress: (done, total, detail) => {
        const message =
          detail?.message ??
          (total > 1 ? `Transcribing audio (chunk ${done}/${total})...` : "Transcribing audio...");
        const transcribePercent =
          detail?.percent !== undefined
            ? detail.percent / 100
            : done / total;
        setIngestionProgress(videoId, "transcribing", message, 10 + transcribePercent * 60);
      },
    });
    if (segments.length) {
      await persistSegments(videoPath, segments);
    }
    return segments;
  } finally {
    await rm(audioPath, { force: true });
  }
}

export async function processVideoTranscription(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) {
    throw new Error("Video not found");
  }

  await prisma.video.update({
    where: { id: videoId },
    data: { status: "PROCESSING", error: null },
  });

  try {
    const uploadDir = getUploadDir();
    const videoPath = getVideoStoragePath(video.filename, uploadDir);

    const duration = (await getMediaDuration(videoPath)) ?? undefined;
    const segments = await getOrCreateSegments(videoId, videoPath, video.title);

    if (!segments.length) {
      throw new Error(
        "Transcription produced no text. Check your Whisper provider configuration and server logs.",
      );
    }

    setIngestionProgress(videoId, "indexing", "Building topic index...", 72);
    const tree = await buildTranscriptTree(segments, video.title, (done, total) => {
      setIngestionProgress(
        videoId,
        "indexing",
        total > 1 ? `Building topic index (${done}/${total})...` : "Building topic index...",
        72 + (done / total) * 23,
      );
    });

    if (!tree.length) {
      throw new Error("Transcription produced no indexable topics");
    }

    setIngestionProgress(videoId, "storing", "Saving transcript index...", 97);
    await storeTranscriptTree(videoId, tree);

    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: "READY",
        duration: duration ?? segments[segments.length - 1]?.end ?? null,
        error: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: "FAILED",
        error: message,
      },
    });
    throw error;
  } finally {
    clearIngestionProgress(videoId);
  }
}

export async function saveDirectTranscript(
  title: string,
  transcript: string,
): Promise<{ videoId: string }> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    throw new Error("Transcript text is required");
  }

  const segments = plainTextToSegments(trimmed);
  const resolvedTitle = title.trim() || "Untitled transcript";
  const tree = await buildTranscriptTree(segments, resolvedTitle);

  if (!tree.length) {
    throw new Error("Transcript produced no indexable topics");
  }

  const video = await prisma.video.create({
    data: {
      title: resolvedTitle,
      filename: `transcript-${Date.now()}.txt`,
      status: "PROCESSING",
    },
  });

  try {
    await storeTranscriptTree(video.id, tree);

    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "READY",
        duration: segments[segments.length - 1]?.end ?? null,
        error: null,
      },
    });

    return { videoId: video.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to index transcript";
    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "FAILED",
        error: message,
      },
    });
    throw error;
  }
}

export async function getVideoTranscript(videoId: string) {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      _count: { select: { nodes: true } },
    },
  });

  if (!video) {
    throw new Error("Video not found");
  }

  const nodes = await getVideoNodeTree(videoId);

  return {
    videoId: video.id,
    title: video.title,
    status: video.status,
    nodeCount: video._count.nodes,
    nodes,
    sections: flattenNodesForLegacy(nodes),
  };
}

function flattenNodesForLegacy(
  nodes: Awaited<ReturnType<typeof getVideoNodeTree>>,
): Array<{
  id: string;
  sectionTitle: string;
  startTime: number;
  endTime: number;
  transcript: string;
  pageLikeIndex: number;
}> {
  const flat: Array<{
    id: string;
    sectionTitle: string;
    startTime: number;
    endTime: number;
    transcript: string;
    pageLikeIndex: number;
  }> = [];

  const walk = (items: typeof nodes) => {
    for (const node of items) {
      if (node.text.trim()) {
        flat.push({
          id: node.id,
          sectionTitle: node.title,
          startTime: node.startTime,
          endTime: node.endTime,
          transcript: node.text,
          pageLikeIndex: node.nodeIndex,
        });
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return flat;
}

export async function listVideos() {
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { nodes: true, sections: true },
      },
    },
  });

  return videos.map((video) => {
    const progress = video.status === "PROCESSING" ? getIngestionProgress(video.id) : null;

    return {
      id: video.id,
      title: video.title,
      filename: video.filename,
      duration: video.duration,
      status: video.status,
      error: video.error,
      createdAt: video.createdAt.toISOString(),
      sectionCount: video._count.nodes || video._count.sections,
      progress: progress
        ? { stage: progress.stage, message: progress.message, percent: progress.percent }
        : null,
    };
  });
}
