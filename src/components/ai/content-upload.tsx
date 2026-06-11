"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TranscriptUpload } from "@/components/ai/transcript-upload";
import { VideoUpload } from "@/components/ai/video-upload";

type ContentUploadProps = {
  onUploaded: (videoId?: string) => void;
};

type UploadMode = "video" | "transcript";

export function ContentUpload({ onUploaded }: ContentUploadProps) {
  const [mode, setMode] = useState<UploadMode>("video");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border p-1">
        <Button
          type="button"
          size="sm"
          variant={mode === "video" ? "default" : "ghost"}
          onClick={() => setMode("video")}
        >
          Upload Video
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "transcript" ? "default" : "ghost"}
          onClick={() => setMode("transcript")}
        >
          Add Transcript
        </Button>
      </div>

      {mode === "video" ? (
        <VideoUpload onUploaded={onUploaded} />
      ) : (
        <TranscriptUpload onUploaded={onUploaded} />
      )}
    </div>
  );
}
