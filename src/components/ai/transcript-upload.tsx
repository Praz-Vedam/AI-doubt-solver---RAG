"use client";

import { FileText } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

type TranscriptUploadProps = {
  onUploaded: (videoId?: string) => void;
};

export function TranscriptUpload({ onUploaded }: TranscriptUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitTranscript = async () => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      setError("Paste or upload transcript text first.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/videos/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled transcript",
          transcript: trimmed,
        }),
      });

      const text = await response.text();
      const data = text ? (JSON.parse(text) as { videoId?: string; error?: string }) : {};

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save transcript");
      }

      setTitle("");
      setTranscript("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onUploaded(data.videoId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save transcript");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setError(null);
    const content = await file.text();
    setTranscript(content);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed bg-muted/30 p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 h-8 w-8 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Add transcript directly</p>
              <p className="text-sm text-muted-foreground">
                Paste text or upload a .txt / .md file. Content is indexed into a topic tree without video
                transcription.
              </p>
            </div>
          </div>

          <Input
            placeholder="Title (optional)"
            value={title}
            disabled={submitting}
            onChange={(event) => setTitle(event.target.value)}
          />

          <Textarea
            placeholder="Paste transcript text here..."
            value={transcript}
            disabled={submitting}
            className="min-h-[180px]"
            onChange={(event) => setTranscript(event.target.value)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.text,text/plain,text/markdown"
              disabled={submitting}
              className="max-w-xs"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleFileUpload(file);
                }
              }}
            />
            <Button type="button" disabled={submitting} onClick={() => void submitTranscript()}>
              {submitting ? "Indexing..." : "Add Transcript"}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <Alert className="border-red-200 bg-red-50 text-red-900">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
