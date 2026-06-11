"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatInterface } from "@/components/ai/chat-interface";
import { ContentUpload } from "@/components/ai/content-upload";
import { TranscriptPanel } from "@/components/ai/transcript-panel";
import { VideoList } from "@/components/ai/video-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { VideoSummary } from "@/types";

export function AiWorkspace() {
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [viewingVideoId, setViewingVideoId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    try {
      const response = await fetch("/api/videos");
      const text = await response.text();
      const data = text ? (JSON.parse(text) as { videos?: VideoSummary[]; error?: string }) : {};

      if (!response.ok) {
        throw new Error(data.error ?? `Failed to load videos (${response.status})`);
      }

      setVideos(data.videos ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load videos");
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  // Poll faster while ingestion is in flight so the progress bar stays live.
  const hasActiveIngestion = videos.some(
    (video) => video.status === "PROCESSING" || video.status === "PENDING",
  );

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  // Poll only while a video is ingesting; no background refresh when all are idle.
  useEffect(() => {
    if (!hasActiveIngestion) {
      return;
    }

    const interval = setInterval(() => {
      void loadVideos();
    }, 2000);

    return () => clearInterval(interval);
  }, [loadVideos, hasActiveIngestion]);

  const toggleVideo = (videoId: string) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId],
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Vectorless RAG
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Video Knowledge Chatbot</h1>
        <p className="max-w-3xl text-muted-foreground">
          Upload educational videos or add transcripts directly, then ask questions answered only from
          a PageIndex-style topic tree built over each lecture.
        </p>
      </header>

      {loadError ? (
        <Alert className="border-red-200 bg-red-50 text-red-900">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Add Content</h2>
          <ContentUpload
            onUploaded={(videoId) => {
              if (videoId) {
                setViewingVideoId(videoId);
                setSelectedVideoIds((current) =>
                  current.includes(videoId) ? current : [...current, videoId],
                );
              }
              void loadVideos();
            }}
          />
        </div>
        <VideoList
          videos={videos}
          selectedVideoIds={selectedVideoIds}
          viewingVideoId={viewingVideoId}
          onToggleVideo={toggleVideo}
          onViewVideo={setViewingVideoId}
          loading={loadingVideos}
        />
      </section>

      <section className="space-y-4">
        <TranscriptPanel
          video={videos.find((video) => video.id === viewingVideoId) ?? null}
        />
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Chat Interface</h2>
          <p className="text-sm text-muted-foreground">
            {selectedVideoIds.length
              ? `Searching ${selectedVideoIds.length} selected video(s)`
              : "Searching all ready videos"}
          </p>
        </div>
        <ChatInterface
          sessionId={sessionId}
          onSessionCreated={setSessionId}
          selectedVideoIds={selectedVideoIds}
          readyVideoCount={videos.filter((video) => video.status === "READY").length}
        />
      </section>
    </div>
  );
}
