import { NextResponse } from "next/server";
import { generateSuggestedFaqs } from "@/services/faqs";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoIdsParam = searchParams.get("videoIds");
    const videoIds = videoIdsParam
      ? videoIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;

    const faqs = await generateSuggestedFaqs(videoIds);
    return NextResponse.json({ faqs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate FAQs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
