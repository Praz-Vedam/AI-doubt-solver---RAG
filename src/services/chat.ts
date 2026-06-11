import { prisma } from "@/lib/db";
import { formatTimestampRange } from "@/lib/utils";
import { completeTextDetailed, streamText, type TokenUsage } from "@/services/llm";
import {
  buildRagUserPrompt,
  retrieveRagContext,
  type RagContext,
} from "@/services/search";
import { enforceNotFoundAnswer } from "@/services/verification";
import type { ChatResponse, SearchResultSection, StreamEvent } from "@/types";

const NOT_FOUND = enforceNotFoundAnswer();

// Human-like hesitation before answering (per the chat-doubt-support design).
function humanPause(minMs = 400, maxMs = 1100): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const SYSTEM_PROMPT = `You are a content-grounded assistant.

Rules:
1. Answer ONLY from the context provided in the user message.
2. Never use external knowledge.
3. Never infer beyond what the context states.
4. Never guess or fabricate.
5. Do not mention timestamps, section IDs, or transcript references in your answer — sources are shown separately.

If the answer is not found in the context, respond with exactly:
"Information not found in uploaded content."`;

function sectionsToSources(sections: SearchResultSection[]): ChatResponse["sources"] {
  return sections.slice(0, 5).map((section) => ({
    sectionId: section.id,
    timestamp: formatTimestampRange(section.startTime, section.endTime),
    sectionTitle: section.sectionTitle,
    videoTitle: section.videoTitle,
    videoId: section.videoId,
  }));
}

function buildChatResponse(
  answer: string,
  sections: SearchResultSection[],
  confidence: number,
  usage?: TokenUsage | null,
): ChatResponse {
  return {
    answer,
    confidence,
    sources: sectionsToSources(sections),
    sectionsUsed: sections.map((section) => section.id),
    usage: usage ?? undefined,
  };
}

function fallbackResponse(sections: SearchResultSection[]): ChatResponse {
  return buildChatResponse(NOT_FOUND, sections, 0);
}

async function answerFromRagContext(
  question: string,
  rag: RagContext,
): Promise<ChatResponse> {
  if (!rag.sections.length) {
    return fallbackResponse([]);
  }

  let answer: string;
  let usage: TokenUsage | null = null;
  try {
    const result = await completeTextDetailed({
      system: SYSTEM_PROMPT,
      user: buildRagUserPrompt(question, rag.context),
      temperature: 0,
      role: "chat",
    });
    answer = result.text;
    usage = result.usage;
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM request failed";
    throw new Error(`Failed to generate answer from retrieved transcript context: ${message}`);
  }

  answer = answer.trim() || NOT_FOUND;
  const confidence = answer === NOT_FOUND ? 0 : 85;
  return buildChatResponse(answer, rag.sections, confidence, usage);
}

export async function generateChatAnswer(options: {
  question: string;
  sessionId?: string;
  videoIds?: string[];
}): Promise<ChatResponse> {
  const question = options.question.trim();
  if (!question) {
    return { answer: NOT_FOUND, confidence: 0, sources: [], sectionsUsed: [] };
  }

  const rag = await retrieveRagContext(question, options.videoIds);
  const response = await answerFromRagContext(question, rag);
  await persistMessages(options.sessionId, question, response);
  return response;
}

export async function* generateChatAnswerEvents(options: {
  question: string;
  sessionId?: string;
  videoIds?: string[];
}): AsyncGenerator<StreamEvent | { type: "meta"; sessionId: string }> {
  const question = options.question.trim();
  let sessionId = options.sessionId;

  if (!sessionId) {
    sessionId = await createChatSession();
  }

  yield { type: "meta", sessionId };

  if (!question) {
    const response: ChatResponse = {
      answer: NOT_FOUND,
      confidence: 0,
      sources: [],
      sectionsUsed: [],
    };
    yield { type: "answer", data: response };
    return;
  }

  yield { type: "status", message: "Reasoning over transcript index..." };

  const rag = await retrieveRagContext(question, options.videoIds);

  if (rag.thinking?.trim()) {
    yield { type: "status", message: rag.thinking.trim() };
  }

  if (!rag.sections.length) {
    const response = fallbackResponse([]);
    await persistMessages(sessionId, question, response);
    yield { type: "answer", data: response };
    return;
  }

  yield {
    type: "status",
    message: `Found ${rag.sections.length} relevant topic node(s). Generating answer...`,
  };

  await humanPause();

  let answer = "";
  let usage: TokenUsage | null = null;
  try {
    const { stream, getUsage } = await streamText({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildRagUserPrompt(question, rag.context) },
      ],
      temperature: 0,
      role: "chat",
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;

      answer += chunk;
      yield { type: "token", content: chunk };
    }

    usage = getUsage();
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM request failed";
    yield { type: "error", message: `Failed to generate answer from retrieved transcript context: ${message}` };
    return;
  }

  answer = answer.trim() || NOT_FOUND;
  const confidence = answer === NOT_FOUND ? 0 : 85;
  const response = buildChatResponse(answer, rag.sections, confidence, usage);
  await persistMessages(sessionId, question, response);
  yield { type: "answer", data: response };
}

async function persistMessages(
  sessionId: string | undefined,
  question: string,
  response: ChatResponse,
): Promise<string | undefined> {
  if (!sessionId) return undefined;

  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) return undefined;

  await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: question,
      },
    }),
    prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: response.answer,
        metadata: {
          confidence: response.confidence,
          sources: response.sources,
          sectionsUsed: response.sectionsUsed,
          ...(response.usage ? { usage: response.usage } : {}),
        },
      },
    }),
  ]);

  return sessionId;
}

export async function createChatSession(): Promise<string> {
  const session = await prisma.chatSession.create({ data: {} });
  return session.id;
}

export async function getChatHistory(sessionId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
  }));
}
