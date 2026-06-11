import { NextResponse } from "next/server";
import {
  createChatSession,
  generateChatAnswer,
  generateChatAnswerEvents,
} from "@/services/chat";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: string;
      sessionId?: string;
      videoIds?: string[];
      stream?: boolean;
    };

    const question = body.question?.trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of generateChatAnswerEvents({
              question,
              sessionId: body.sessionId,
              videoIds: body.videoIds,
            })) {
              if (event.type === "meta") {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                );
                continue;
              }

              if (
                event.type === "token" ||
                event.type === "status" ||
                event.type === "error"
              ) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                );
                continue;
              }

              if (event.type === "answer") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "complete", data: event.data })}\n\n`,
                  ),
                );
              }
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            const message = error instanceof Error ? error.message : "Chat request failed";
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", message })}\n\n`,
              ),
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    let sessionId = body.sessionId;
    if (!sessionId) {
      sessionId = await createChatSession();
    }

    const result = await generateChatAnswer({
      question,
      sessionId,
      videoIds: body.videoIds,
    });

    return NextResponse.json({ sessionId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
