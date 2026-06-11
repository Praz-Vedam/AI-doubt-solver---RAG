import { NextResponse } from "next/server";
import { processVideoTranscription } from "@/services/ingestion";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { videoId?: string };
    if (!body.videoId) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }

    await processVideoTranscription(body.videoId);
    return NextResponse.json({ videoId: body.videoId, status: "READY" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
