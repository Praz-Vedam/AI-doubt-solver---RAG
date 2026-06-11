"use client";

import { Activity, BookOpen, Clock3, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatResponse } from "@/types";

type AnswerPanelProps = {
  response: ChatResponse | null;
  loading: boolean;
  streamingAnswer: string;
  inferenceLogs: string[];
};

export function AnswerPanel({
  response,
  loading,
  streamingAnswer,
  inferenceLogs,
}: AnswerPanelProps) {
  const answer = response?.answer ?? streamingAnswer;
  const confidence = response?.confidence ?? 0;

  return (
    <Card className="min-h-[640px]">
      <CardHeader>
        <CardTitle>Answer Area</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4" />
            Inference Log
          </div>
          {!inferenceLogs.length && !loading ? (
            <p className="text-sm text-muted-foreground">
              Retrieval and generation steps will appear here while answering.
            </p>
          ) : (
            <ScrollArea className="h-28 rounded-lg border bg-muted/20 p-3">
              <div className="space-y-1.5 font-mono text-xs leading-5 text-muted-foreground">
                {inferenceLogs.map((log, index) => (
                  <p key={`${log}-${index}`}>
                    <span className="text-foreground/50">[{index + 1}]</span> {log}
                  </p>
                ))}
                {loading ? (
                  <p className="animate-pulse text-foreground/70">Generating answer...</p>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="h-4 w-4" />
            Answer
          </div>
          {loading && !answer ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-7">
              {answer || "Ask a question to get an answer from your uploaded content."}
            </div>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4" />
            Confidence &amp; Stats
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{confidence}%</span>
              <Badge variant={confidence >= 70 ? "success" : confidence > 0 ? "warning" : "secondary"}>
                {confidence >= 70 ? "High" : confidence > 0 ? "Low" : "Unknown"}
              </Badge>
            </div>
            <Progress value={confidence} />
            {response?.usage ? (
              <p className="text-xs text-muted-foreground">
                Token usage: {response.usage.totalTokens} total ({response.usage.promptTokens} prompt
                + {response.usage.completionTokens} completion)
              </p>
            ) : null}
            {response?.sectionsUsed?.length ? (
              <p className="text-xs text-muted-foreground">
                {response.sectionsUsed.length} transcript section
                {response.sectionsUsed.length === 1 ? "" : "s"} retrieved
              </p>
            ) : null}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4" />
            Transcript Sources
          </div>
          {!response?.sources?.length ? (
            <p className="text-sm text-muted-foreground">No transcript sources yet.</p>
          ) : (
            <ScrollArea className="h-40 pr-3">
              <div className="space-y-3">
                {response.sources.map((source) => (
                  <div key={source.sectionId} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{source.sectionTitle ?? source.sectionId}</p>
                    <p className="text-xs text-muted-foreground">{source.videoTitle}</p>
                    <p className="mt-1 text-xs">{source.timestamp}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4" />
            Transcript Sections Used
          </div>
          {!response?.sectionsUsed?.length ? (
            <p className="text-sm text-muted-foreground">
              Section IDs will appear after an answer is generated.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {response.sectionsUsed.map((sectionId) => (
                <Badge key={sectionId} variant="outline">
                  {sectionId.slice(0, 8)}...
                </Badge>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
