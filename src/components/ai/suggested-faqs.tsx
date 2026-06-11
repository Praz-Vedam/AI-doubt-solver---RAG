"use client";

import { HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { FaqItem } from "@/types";

type SuggestedFaqsProps = {
  selectedVideoIds: string[];
  readyVideoCount: number;
  onSelectQuestion: (question: string, videoId?: string) => void;
  disabled?: boolean;
};

export function SuggestedFaqs({
  selectedVideoIds,
  readyVideoCount,
  onSelectQuestion,
  disabled,
}: SuggestedFaqsProps) {
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFaqs = useCallback(async () => {
    if (!readyVideoCount) {
      setFaqs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedVideoIds.length) {
        params.set("videoIds", selectedVideoIds.join(","));
      }

      const response = await fetch(`/api/faqs?${params.toString()}`);
      const text = await response.text();
      const data = text ? (JSON.parse(text) as { faqs?: FaqItem[]; error?: string }) : {};

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load suggested questions");
      }

      setFaqs(data.faqs ?? []);
    } catch (loadError) {
      setFaqs([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load suggested questions");
    } finally {
      setLoading(false);
    }
  }, [readyVideoCount, selectedVideoIds]);

  useEffect(() => {
    void loadFaqs();
  }, [loadFaqs]);

  if (!readyVideoCount) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4" />
            Suggested FAQs
          </CardTitle>
          <CardDescription>
            Important questions and answers drawn from{" "}
            {selectedVideoIds.length
              ? "selected lecture transcripts"
              : "all ready lecture transcripts"}
            . Click a question to explore it further in chat.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || disabled}
          onClick={() => void loadFaqs()}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : faqs.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {faqs.map((faq) => (
              <button
                key={`${faq.videoTitle}-${faq.question}`}
                type="button"
                disabled={disabled}
                onClick={() => onSelectQuestion(faq.question, faq.videoId)}
                className="rounded-lg border bg-muted/20 p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <p className="font-medium leading-relaxed">{faq.question}</p>
                {faq.answer ? (
                  <p className="mt-2 text-muted-foreground leading-relaxed">{faq.answer}</p>
                ) : null}
                {faq.videoTitle ? (
                  <Badge variant="secondary" className="mt-2">
                    {faq.videoTitle}
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No suggested questions yet. Upload and process a transcript first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
