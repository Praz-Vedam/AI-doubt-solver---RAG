import { NextResponse } from "next/server";
import { getMaxUploadBytes } from "@/lib/utils";
import { listVideos, processVideoTranscription, saveUploadedVideo } from "@/services/ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const videos = await listVideos();
    return NextResponse.json({ videos });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load videos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A video file is required" }, { status: 400 });
    }

    if (file.size > getMaxUploadBytes()) {
      return NextResponse.json({ error: "File exceeds maximum upload size" }, { status: 413 });
    }

    const { videoId, filename } = await saveUploadedVideo(file);

    void processVideoTranscription(videoId).catch((error) => {
      console.error(`Background transcription failed for ${videoId}:`, error);
    });

    return NextResponse.json({
      videoId,
      filename,
      status: "PROCESSING",
      message: "Video uploaded. Transcription started.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
