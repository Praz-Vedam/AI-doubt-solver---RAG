import { searchTreeForQuestion } from "@/services/tree-search";
import type { SearchResultSection } from "@/types";

export function buildContext(sections: SearchResultSection[]): string {
  return sections
    .map((section) => {
      return `Node ID: ${section.id}
Video: ${section.videoTitle ?? section.videoId}
Topic: ${section.sectionTitle}
Timestamp: ${section.startTime}s - ${section.endTime}s
Transcript:
${section.transcript}`;
    })
    .join("\n\n---\n\n");
}

export type RagContext = {
  sections: SearchResultSection[];
  context: string;
  thinking?: string;
};

export async function searchRelevantSections(
  question: string,
  videoIds?: string[],
): Promise<SearchResultSection[]> {
  const { sections } = await searchTreeForQuestion(question, videoIds);
  return sections;
}

export async function retrieveRagContext(
  question: string,
  videoIds?: string[],
): Promise<RagContext> {
  const { sections, thinking } = await searchTreeForQuestion(question, videoIds);
  return {
    sections,
    context: buildContext(sections),
    thinking,
  };
}

export function buildRagUserPrompt(question: string, context: string): string {
  return `Use only the transcript context below to answer the question.

Question:
${question}

Transcript Context:
${context}

Answer the question in clear prose. Reference timestamps when they help the user locate the source. If the context does not contain the answer, respond with exactly:
"Information not found in uploaded content."`;
}
