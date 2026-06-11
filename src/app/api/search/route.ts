import { NextResponse } from "next/server";
import { normalizeQuery } from "@/services/query-variants";
import { retrieveRagContext } from "@/services/search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: string;
      videoIds?: string[];
    };

    const query = normalizeQuery(body.query ?? "");
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const rag = await retrieveRagContext(query, body.videoIds);

    return NextResponse.json({
      query,
      thinking: rag.thinking,
      sections: rag.sections,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
