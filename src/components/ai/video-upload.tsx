"use client";

import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VideoUploadProps = {
  onUploaded: (videoId?: string) => void;
};

export function VideoUpload({ onUploaded }: VideoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/videos/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as { videoId?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      onUploaded(data.videoId);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed bg-muted/30 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Upload educational videos</p>
            <p className="text-sm text-muted-foreground">
              MP4, MOV, WEBM, or MKV. Audio is extracted locally and transcribed with Whisper.
            </p>
          </div>
          <Input
            ref={inputRef}
            type="file"
            accept="video/*"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUpload(file);
              }
            }}
          />
          <Button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading..." : "Choose Video"}
          </Button>
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
