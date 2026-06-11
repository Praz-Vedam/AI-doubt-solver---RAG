"use client";

import { CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatTimestamp } from "@/lib/utils";
import type { VideoSummary } from "@/types";

type VideoListProps = {
  videos: VideoSummary[];
  selectedVideoIds: string[];
  viewingVideoId: string | null;
  onToggleVideo: (videoId: string) => void;
  onViewVideo: (videoId: string) => void;
  loading?: boolean;
};

function statusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "READY":
      return "success";
    case "PROCESSING":
      return "warning";
    case "FAILED":
      return "destructive";
    default:
      return "secondary";
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "READY") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "PROCESSING") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (status === "FAILED") return <XCircle className="h-4 w-4" />;
  return <Clock3 className="h-4 w-4" />;
}

function isTranscriptOnly(filename: string): boolean {
  return filename.startsWith("transcript-");
}

export function VideoList({
  videos,
  selectedVideoIds,
  viewingVideoId,
  onToggleVideo,
  onViewVideo,
  loading,
}: VideoListProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Uploaded Videos</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading videos...</p>
        ) : videos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No videos uploaded yet.</p>
        ) : (
          <ScrollArea className="h-[420px] pr-3">
            <div className="space-y-3">
              {videos.map((video) => {
                const selected = selectedVideoIds.includes(video.id);
                const viewing = viewingVideoId === video.id;
                return (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => {
                      onViewVideo(video.id);
                      onToggleVideo(video.id);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      selected || viewing
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{video.title}</p>
                          {isTranscriptOnly(video.filename) ? (
                            <Badge variant="secondary">Transcript</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{video.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {video.duration ? formatTimestamp(video.duration) : "Duration pending"} ·{" "}
                          {video.sectionCount} sections
                        </p>
                        {video.error ? (
                          <p className="text-xs text-red-600">{video.error}</p>
                        ) : null}
                        {video.status === "PROCESSING" ? (
                          <div className="space-y-1 pt-1">
                            <Progress
                              value={video.progress?.percent ?? null}
                              className="h-1.5 w-48"
                            />
                            <p className="text-xs text-muted-foreground">
                              {video.progress
                                ? `${video.progress.message} ${video.progress.percent}%`
                                : "Processing..."}
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <Badge variant={statusVariant(video.status)} className="gap-1">
                        <StatusIcon status={video.status} />
                        {video.status}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
