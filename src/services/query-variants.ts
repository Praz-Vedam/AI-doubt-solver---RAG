import { completeJson } from "@/services/llm";

export async function generateQueryVariants(question: string): Promise<string[]> {
  const base = question.trim();
  if (!base) return [];

  try {
    const result = await completeJson<{ variants: string[] }>({
      system: `You generate PostgreSQL full-text search query variants.
Return JSON: {"variants": string[]}
Rules:
- Include the original question wording.
- Add 3-6 shorter keyword phrases useful for lexical search.
- No embeddings, no semantic paraphrases beyond lexical variants.
- Keep each variant under 12 words.`,
      user: `Question: ${base}`,
      temperature: 0.2,
    });

    const variants = result.variants?.filter(Boolean) ?? [];
    return [...new Set([base, ...variants])].slice(0, 8);
  } catch {
    const tokens = base
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2);

    const variants = [base];
    if (tokens.length >= 2) {
      variants.push(tokens.slice(-2).join(" "));
    }
    if (tokens.length >= 3) {
      variants.push(tokens.slice(-3).join(" "));
    }

    return [...new Set(variants)];
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}
