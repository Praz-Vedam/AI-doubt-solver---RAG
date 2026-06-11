"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestampRange } from "@/lib/utils";
import type { TranscriptNodeView, VideoSummary, VideoTranscript } from "@/types";

type TranscriptPanelProps = {
  video: VideoSummary | null;
};

function collectLeafNodes(nodes: TranscriptNodeView[]): TranscriptNodeView[] {
  const leaves: TranscriptNodeView[] = [];

  const walk = (items: TranscriptNodeView[]) => {
    for (const node of items) {
      if (node.text.trim()) {
        leaves.push(node);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return leaves;
}

function PageIndexBar({
  nodes,
  duration,
  activeNodeId,
  onSelect,
}: {
  nodes: TranscriptNodeView[];
  duration: number;
  activeNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const total = duration > 0 ? duration : nodes[nodes.length - 1]?.endTime ?? 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Page index</span>
        <span>{nodes.length} topic{nodes.length === 1 ? "" : "s"}</span>
      </div>
      <div className="flex h-8 overflow-hidden rounded-md border bg-muted/30">
        {nodes.map((node, index) => {
          const span = Math.max(node.endTime - node.startTime, 1);
          const width = `${(span / total) * 100}%`;
          const isActive = activeNodeId === node.id;

          return (
            <button
              key={node.id}
              type="button"
              title={`${index + 1}. ${node.title}`}
              onClick={() => onSelect(node.id)}
              style={{ width }}
              className={`min-w-[8px] border-r border-background/60 text-[10px] transition-colors last:border-r-0 ${
                isActive ? "bg-primary text-primary-foreground" : "bg-primary/20 hover:bg-primary/40"
              }`}
            >
              <span className="sr-only">{node.title}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {nodes.map((node, index) => (
          <button
            key={`${node.id}-label`}
            type="button"
            onClick={() => onSelect(node.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              activeNodeId === node.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function TranscriptNodeCard({
  node,
  activeNodeId,
  onSelect,
}: {
  node: TranscriptNodeView;
  activeNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const isActive = activeNodeId === node.id;

  return (
    <div className="space-y-3">
      <article
        id={`node-${node.id}`}
        className={`rounded-lg border p-4 transition-colors ${
          isActive ? "border-primary bg-primary/5" : "bg-muted/20"
        }`}
        style={{ marginLeft: `${node.depth * 12}px` }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            {node.depth > 0 ? "↳ " : ""}
            {node.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {formatTimestampRange(node.startTime, node.endTime)}
          </p>
        </div>
        {node.summary ? (
          <p className="mb-2 text-sm text-muted-foreground">{node.summary}</p>
        ) : null}
        {node.text ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{node.text}</p>
        ) : null}
        {!node.text && node.children?.length ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onSelect(node.children![0].id)}
          >
            View subtopics
          </button>
        ) : null}
      </article>

      {node.children?.map((child) => (
        <TranscriptNodeCard
          key={child.id}
          node={child}
          activeNodeId={activeNodeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function TranscriptPanel({ video }: TranscriptPanelProps) {
  const [transcript, setTranscript] = useState<VideoTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const videoId = video?.id ?? null;
  const videoStatus = video?.status ?? null;
  const videoSectionCount = video?.sectionCount ?? 0;

  useEffect(() => {
    if (!videoId || videoStatus !== "READY" || videoSectionCount === 0) {
      setTranscript(null);
      setError(null);
      setActiveNodeId(null);
      return;
    }

    let cancelled = false;

    const loadTranscript = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/videos/transcript?videoId=${videoId}`);
        const text = await response.text();
        const data: VideoTranscript & { error?: string } = text
          ? (JSON.parse(text) as VideoTranscript & { error?: string })
          : { videoId: "", title: "", status: "", nodes: [] };

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load transcript");
        }

        if (!cancelled) {
          setTranscript(data.nodes.length ? data : null);
          setActiveNodeId(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setTranscript(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load transcript");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadTranscript();

    return () => {
      cancelled = true;
    };
  }, [videoId, videoStatus, videoSectionCount]);

  const leafNodes = useMemo(
    () => collectLeafNodes(transcript?.nodes ?? []),
    [transcript?.nodes],
  );

  const handleSelectNode = (nodeId: string) => {
    setActiveNodeId(nodeId);
    document.getElementById(`node-${nodeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!video) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>Select a processed video to view its topic index and transcript.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (video.status === "PROCESSING" || video.status === "PENDING") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {video.title} is still processing. The topic index will appear here when ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (video.status === "FAILED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {video.title} failed to process{video.error ? `: ${video.error}` : "."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcript Index</CardTitle>
        <CardDescription>
          {video.title} · {transcript?.nodeCount ?? video.sectionCount} indexed topic
          {(transcript?.nodeCount ?? video.sectionCount) === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : transcript?.nodes.length ? (
          <>
            <PageIndexBar
              nodes={leafNodes}
              duration={video.duration ?? leafNodes[leafNodes.length - 1]?.endTime ?? 0}
              activeNodeId={activeNodeId}
              onSelect={handleSelectNode}
            />
            <ScrollArea className="h-[420px] pr-3">
              <div className="space-y-4">
                {transcript.nodes.map((node) => (
                  <TranscriptNodeCard
                    key={node.id}
                    node={node}
                    activeNodeId={activeNodeId}
                    onSelect={handleSelectNode}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No topic index yet. Re-upload or re-process this lecture to build the PageIndex tree.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
