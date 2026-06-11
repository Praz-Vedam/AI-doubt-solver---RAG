import { completeText } from "@/services/llm";
import type { SearchResultSection } from "@/types";

const NOT_FOUND = "Information not found in uploaded content.";

export async function verifyAnswerSupport(
  question: string,
  sections: SearchResultSection[],
  answer: string,
): Promise<"SUPPORTED" | "UNSUPPORTED"> {
  if (!answer.trim() || answer.trim() === NOT_FOUND) {
    return "UNSUPPORTED";
  }

  const context = sections
    .map(
      (section) =>
        `[${section.id}] ${section.sectionTitle}\n${section.transcript}`,
    )
    .join("\n\n");

  const verdict = await completeText({
    system: `You validate transcript-grounded answers.
Determine whether the answer's main claims are directly supported by the supplied transcript sections.
Minor paraphrasing is acceptable. Reject only if the answer adds facts not present in the transcript or contradicts it.
Return exactly one word: SUPPORTED or UNSUPPORTED.`,
    user: `Question:\n${question}\n\nTranscript Sections:\n${context}\n\nAnswer:\n${answer}`,
    temperature: 0,
  });

  const normalized = verdict.toUpperCase().trim();
  if (normalized.startsWith("SUPPORTED")) {
    return "SUPPORTED";
  }
  return "UNSUPPORTED";
}

export function enforceNotFoundAnswer(): string {
  return NOT_FOUND;
}
