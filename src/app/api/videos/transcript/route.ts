import { NextResponse } from "next/server";
import { getVideoTranscript, saveDirectTranscript } from "@/services/ingestion";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");

    if (!videoId) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }

    const transcript = await getVideoTranscript(videoId);
    return NextResponse.json(transcript);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load transcript";
    const status = message === "Video not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: string; transcript?: string };
    const title = body.title?.trim() ?? "";
    const transcript = body.transcript?.trim() ?? "";

    if (!transcript) {
      return NextResponse.json({ error: "Transcript text is required" }, { status: 400 });
    }

    const { videoId } = await saveDirectTranscript(title, transcript);

    return NextResponse.json({
      videoId,
      status: "READY",
      message: "Transcript indexed and ready for search.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
