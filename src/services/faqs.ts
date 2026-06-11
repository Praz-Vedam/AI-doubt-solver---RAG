import { prisma } from "@/lib/db";
import { completeJson } from "@/services/llm";
import type { FaqItem } from "@/types";

const MAX_VIDEOS = 6;
const MAX_SECTIONS_PER_VIDEO = 4;
const EXCERPT_CHARS = 1200;
const TARGET_FAQ_COUNT = 8;

type TranscriptSection = {
  sectionTitle: string;
  excerpt: string;
};

type TranscriptSource = {
  videoId: string;
  title: string;
  sections: TranscriptSection[];
};

function pickRepresentativeNodes<T extends { nodeIndex: number }>(nodes: T[], max: number): T[] {
  if (nodes.length <= max) return nodes;
  if (max <= 1) return [nodes[0]];

  const picked: T[] = [];
  const used = new Set<number>();

  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i / (max - 1)) * (nodes.length - 1));
    if (!used.has(index)) {
      used.add(index);
      picked.push(nodes[index]);
    }
  }

  return picked;
}

async function getTranscriptSources(videoIds?: string[]): Promise<TranscriptSource[]> {
  const videos = await prisma.video.findMany({
    where: {
      status: "READY",
      nodes: { some: {} },
      ...(videoIds?.length ? { id: { in: videoIds } } : {}),
    },
    include: {
      nodes: {
        where: { text: { not: "" } },
        orderBy: { nodeIndex: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_VIDEOS,
  });

  return videos
    .map((video) => ({
      videoId: video.id,
      title: video.title,
      sections: pickRepresentativeNodes(video.nodes, MAX_SECTIONS_PER_VIDEO).map((node) => ({
        sectionTitle: node.title,
        excerpt: `${node.summary}\n\n${node.text}`.trim().slice(0, EXCERPT_CHARS),
      })),
    }))
    .filter((source) => source.sections.length > 0);
}

function cleanTopic(text: string): string {
  return text
    .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g, "")
    .replace(/^Section \d+:\s*/i, "")
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptAnswer(excerpt: string, maxLen = 240): string {
  const sentences = excerpt
    .split(/[.!?]/)
    .map((part) => cleanTopic(part))
    .filter((part) => part.length > 30);

  const answer =
    sentences.find((part) => /\b(is|are|means|because|when|how|why|involves|refers)\b/i.test(part)) ??
    sentences[0] ??
    cleanTopic(excerpt);

  if (!answer) return "See the lecture transcript for details.";
  if (answer.length <= maxLen) return answer;

  const truncated = answer.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 80 ? lastSpace : maxLen).trim()}…`;
}

function sectionTopic(section: TranscriptSection): string {
  const fromTitle = cleanTopic(section.sectionTitle);
  if (fromTitle.length >= 12 && fromTitle.length <= 90) return fromTitle;

  const firstSentence = section.excerpt
    .split(/[.!?]/)
    .map((part) => cleanTopic(part))
    .find((part) => part.length > 20);

  return firstSentence?.slice(0, 80) ?? "this topic";
}

function isLowQualityFaq(faq: FaqItem): boolean {
  const question = faq.question.trim();
  const answer = faq.answer?.trim() ?? "";
  const lower = question.toLowerCase();

  if (!answer || answer.length < 20) return true;
  if (question.length < 15 || question.length > 160) return true;

  const bannedPatterns = [
    /^what does .+ say about/i,
    /^what is (this|the) lecture/i,
    /main topics covered/i,
    /key concepts should i remember/i,
    /summarize the main ideas/i,
    /what topics are covered/i,
    /what will i learn/i,
    /overview of the lecture/i,
  ];

  if (bannedPatterns.some((pattern) => pattern.test(question))) return true;

  const quoteMatch = question.match(/"[^"]{50,}"/);
  if (quoteMatch) return true;

  if (lower.split(/\s+/).length < 4) return true;

  return false;
}

function normalizeQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

function dedupeFaqs(faqs: FaqItem[]): FaqItem[] {
  const seen = new Set<string>();

  return faqs.filter((faq) => {
    const key = faq.question
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSourcesForPrompt(sources: TranscriptSource[]): string {
  return sources
    .map((source) =>
      source.sections
        .map(
          (section) =>
            `Lecture: ${source.title}\nVideo ID: ${source.videoId}\nSection: ${section.sectionTitle}\nExcerpt: ${section.excerpt || "(no text available)"}`,
        )
        .join("\n\n"),
    )
    .join("\n\n---\n\n");
}

function fallbackFaqs(sources: TranscriptSource[]): FaqItem[] {
  const faqs: FaqItem[] = [];

  for (const source of sources) {
    for (const section of source.sections.slice(0, 2)) {
      const topic = sectionTopic(section);
      const answer = excerptAnswer(section.excerpt);
      const sentences = section.excerpt
        .split(/[.!?]/)
        .map((part) => cleanTopic(part))
        .filter((part) => part.length > 35);

      const definitional = sentences.find((part) => /\b(is|are|means|refers to)\b/i.test(part));

      if (definitional) {
        const subject = definitional.split(/\b(is|are|means|refers to)\b/i)[0]?.trim();
        if (subject && subject.length >= 8 && subject.length <= 70) {
          faqs.push({
            question: normalizeQuestion(`What is ${subject}`),
            answer: definitional,
            videoTitle: source.title,
            videoId: source.videoId,
          });
          continue;
        }
      }

      const procedural = sentences.find((part) => /\b(how to|steps|first|then|process)\b/i.test(part));
      if (procedural) {
        faqs.push({
          question: normalizeQuestion(`How does ${topic} work`),
          answer: procedural,
          videoTitle: source.title,
          videoId: source.videoId,
        });
        continue;
      }

      faqs.push({
        question: normalizeQuestion(`What is explained about ${topic}`),
        answer,
        videoTitle: source.title,
        videoId: source.videoId,
      });
    }
  }

  return dedupeFaqs(faqs.filter((faq) => !isLowQualityFaq(faq))).slice(0, TARGET_FAQ_COUNT);
}

function normalizeGeneratedFaqs(
  rawFaqs: FaqItem[],
  sources: TranscriptSource[],
): FaqItem[] {
  const allowedVideoIds = new Set(sources.map((source) => source.videoId));
  const titleById = new Map(sources.map((source) => [source.videoId, source.title]));

  return dedupeFaqs(
    rawFaqs
      .filter((faq) => faq.question?.trim() && faq.answer?.trim())
      .map((faq) => {
        const videoId =
          faq.videoId && allowedVideoIds.has(faq.videoId) ? faq.videoId : sources[0]?.videoId;

        return {
          question: normalizeQuestion(faq.question),
          answer: faq.answer!.trim(),
          videoTitle: faq.videoTitle?.trim() || titleById.get(videoId ?? "") || sources[0]?.title,
          videoId,
        };
      })
      .filter((faq) => !isLowQualityFaq(faq)),
  ).slice(0, TARGET_FAQ_COUNT);
}

export async function generateSuggestedFaqs(videoIds?: string[]): Promise<FaqItem[]> {
  const sources = await getTranscriptSources(videoIds);
  if (!sources.length) {
    return [];
  }

  const scopeLabel =
    videoIds?.length === 1
      ? `the selected lecture "${sources[0]?.title}"`
      : videoIds?.length
        ? "the selected lectures"
        : "all uploaded lectures";

  try {
    const result = await completeJson<{ faqs: FaqItem[] }>({
      system: `You are an instructional designer creating high-quality FAQ entries for students reviewing lecture transcripts.

Return JSON: {"faqs": [{"question": string, "answer": string, "videoTitle": string, "videoId": string}]}

Prioritize the most important, substantive knowledge in the excerpts:
- Core definitions, principles, and terminology
- How something works, why it matters, or when it applies
- Comparisons, cause-and-effect, and step-by-step explanations
- Concrete facts, examples, or conclusions students need to remember

Question rules:
- Write natural questions a thoughtful student would ask before an exam
- Be specific to the material; each question should target one clear idea
- Keep questions under 140 characters
- Do NOT ask meta questions about the lecture itself (e.g. "What topics are covered?", "What are the key concepts?")
- Do NOT embed long verbatim quotes from the transcript in the question
- Do NOT ask vague questions like "What does the lecture say about ...?"

Answer rules:
- 1 to 3 concise sentences, student-friendly and factual
- Ground every answer ONLY in the provided excerpts
- Do not invent details not present in the transcript

Coverage:
- Generate 8 to 10 FAQ pairs, then keep only the strongest ones
- Spread questions across different sections and lectures when multiple sources are provided
- Avoid near-duplicate questions
- Set videoTitle and videoId to the matching lecture for each pair`,
      user: `Create the most important and sensible student FAQs for ${scopeLabel}.

Transcript excerpts:
${formatSourcesForPrompt(sources)}`,
      temperature: 0.2,
      role: "index",
      // FAQs must always be generated by Ollama, regardless of role/env provider config.
      provider: "ollama",
    });

    const faqs = normalizeGeneratedFaqs(result.faqs ?? [], sources);
    if (faqs.length >= 4) {
      return faqs;
    }
  } catch {
    // Fall through to heuristic FAQs.
  }

  return fallbackFaqs(sources);
}
