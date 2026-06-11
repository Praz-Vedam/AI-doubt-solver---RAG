export type IngestionStage = "extracting" | "transcribing" | "indexing" | "storing";

export type IngestionProgress = {
  stage: IngestionStage;
  message: string;
  percent: number;
  updatedAt: number;
};

// In-memory store keyed by videoId. Survives dev HMR via globalThis; progress
// is ephemeral by design (a restart mid-ingestion leaves the video PROCESSING
// with no progress, which the UI handles).
const globalForProgress = globalThis as unknown as {
  ingestionProgress: Map<string, IngestionProgress> | undefined;
};

const store = globalForProgress.ingestionProgress ?? new Map<string, IngestionProgress>();
globalForProgress.ingestionProgress = store;

export function setIngestionProgress(
  videoId: string,
  stage: IngestionStage,
  message: string,
  percent: number,
): void {
  store.set(videoId, {
    stage,
    message,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    updatedAt: Date.now(),
  });
}

export function getIngestionProgress(videoId: string): IngestionProgress | null {
  return store.get(videoId) ?? null;
}

export function clearIngestionProgress(videoId: string): void {
  store.delete(videoId);
}
