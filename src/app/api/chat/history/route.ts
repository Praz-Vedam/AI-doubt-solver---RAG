import { NextResponse } from "next/server";
import { getChatHistory } from "@/services/chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const messages = await getChatHistory(sessionId);
  return NextResponse.json({ sessionId, messages });
}
