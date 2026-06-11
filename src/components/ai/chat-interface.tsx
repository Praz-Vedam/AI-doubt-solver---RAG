"use client";

import { SendHorizonal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/input";
import type { ChatResponse } from "@/types";
import { AnswerPanel } from "./answer-panel";
import { SuggestedFaqs } from "./suggested-faqs";

type HistoryMessage = {
  id: string;
  role: string;
  content: string;
  metadata?: {
    confidence?: number;
    sources?: ChatResponse["sources"];
    sectionsUsed?: string[];
  };
};

type ChatInterfaceProps = {
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  selectedVideoIds: string[];
  readyVideoCount: number;
};


export function ChatInterface({
  sessionId,
  onSessionCreated,
  selectedVideoIds,
  readyVideoCount,
}: ChatInterfaceProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [latestResponse, setLatestResponse] = useState<ChatResponse | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inferenceLogs, setInferenceLogs] = useState<string[]>([]);
  const [faqScopeVideoIds, setFaqScopeVideoIds] = useState<string[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const thinking = loading && !streamingAnswer;

  useEffect(() => {
    if (!sessionId) return;

    void fetch(`/api/chat/history?sessionId=${sessionId}`)
      .then((response) => response.json())
      .then((data) => setHistory(data.messages ?? []))
      .catch(() => setHistory([]));
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingAnswer, latestResponse]);

  const submitQuestion = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setInferenceLogs([]);
    setStreamingAnswer("");
    setLatestResponse(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          sessionId,
          videoIds:
            faqScopeVideoIds ??
            (selectedVideoIds.length ? selectedVideoIds : undefined),
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json();
        throw new Error(data.error ?? "Chat request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activeSessionId = sessionId;
      let finalResponse: ChatResponse | null = null;

      const processSseBlocks = (blocks: string[]) => {
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;

          const event = JSON.parse(payload) as
            | { type: "meta"; sessionId: string }
            | { type: "status"; message: string }
            | { type: "token"; content: string }
            | { type: "complete"; data: ChatResponse }
            | { type: "error"; message: string };

          if (event.type === "meta") {
            activeSessionId = event.sessionId;
            if (!sessionId) {
              onSessionCreated(event.sessionId);
            }
          }

          if (event.type === "status") {
            setInferenceLogs((current) => [...current, event.message]);
          }

          if (event.type === "token") {
            setStreamingAnswer((current) => current + event.content);
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }

          if (event.type === "complete") {
            finalResponse = event.data;
            setLatestResponse(event.data);
            setStreamingAnswer(event.data.answer);
          }
        }
      };

      const drainSseBuffer = (flush = false) => {
        const blocks = buffer.split("\n\n");
        if (flush) {
          buffer = "";
          processSseBlocks(blocks);
          return;
        }

        buffer = blocks.pop() ?? "";
        processSseBlocks(blocks);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          drainSseBuffer();
        }
        if (done) {
          drainSseBuffer(true);
          break;
        }
      }

      if (activeSessionId) {
        const historyResponse = await fetch(`/api/chat/history?sessionId=${activeSessionId}`);
        const historyData = await historyResponse.json();
        setHistory(historyData.messages ?? []);
      }

      if (finalResponse) {
        setLatestResponse(finalResponse);
      }

      setQuestion("");
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat request failed");
    } finally {
      setFaqScopeVideoIds(null);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
    <div className="grid h-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="flex min-h-[640px] flex-col">
        <CardHeader>
          <CardTitle>Chat Interface</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <ScrollArea className="flex-1 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-4">
              {history
                .filter((message) => message.role === "user")
                .map((message) => (
                  <div
                    key={message.id}
                    className="ml-auto max-w-[90%] rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground"
                  >
                    {message.content}
                  </div>
                ))}

              {thinking ? (
                <div className="flex max-w-[90%] items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                  </span>
                  <span className="italic">Thinking...</span>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="space-y-3">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about your uploaded videos..."
              rows={4}
              disabled={loading}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitQuestion();
                }
              }}
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button onClick={() => void submitQuestion()} disabled={loading || !question.trim()}>
              <SendHorizonal className="h-4 w-4" />
              {loading ? "Thinking..." : "Ask Question"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AnswerPanel
        response={latestResponse}
        loading={loading}
        streamingAnswer={streamingAnswer}
        inferenceLogs={inferenceLogs}
      />
    </div>

    <SuggestedFaqs
      selectedVideoIds={selectedVideoIds}
      readyVideoCount={readyVideoCount}
      disabled={loading}
      onSelectQuestion={(nextQuestion, videoId) => {
        setQuestion(nextQuestion);
        setFaqScopeVideoIds(videoId ? [videoId] : null);
      }}
    />
    </div>
  );
}
