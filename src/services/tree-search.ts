import { completeJson } from "@/services/llm";
import {
  buildTreeSearchPrompt,
  getLeafNodesByVideoIds,
  getSearchTrees,
  nodesToSearchResults,
} from "@/services/tree-store";
import type { SearchResultSection } from "@/types";

type TreeSearchResult = {
  thinking?: string;
  node_list?: string[];
};

function getTopK(): number {
  const parsed = Number(process.env.RAG_TOP_K);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

export async function searchTreeForQuestion(
  question: string,
  videoIds?: string[],
): Promise<{ sections: SearchResultSection[]; thinking?: string }> {
  const trees = await getSearchTrees(videoIds);
  if (!trees.length) {
    return { sections: [] };
  }

  try {
    const result = await completeJson<TreeSearchResult>({
      system: `You search a hierarchical lecture transcript index using reasoning, not keyword matching.
Given a question and a tree of topic nodes (titles + summaries), return the node ids most likely to contain the answer.
Respond with valid JSON only.`,
      user: buildTreeSearchPrompt(question, trees),
      temperature: 0,
      role: "chat",
    });

    const nodeIds = (result.node_list ?? []).filter(Boolean);
    const sections = (await nodesToSearchResults(nodeIds)).slice(0, getTopK());

    if (sections.length) {
      return { sections, thinking: result.thinking };
    }
  } catch {
    // Fall through to leaf sampling.
  }

  if (videoIds?.length) {
    const fallback = await getLeafNodesByVideoIds(videoIds, 6);
    if (fallback.length) {
      return { sections: fallback };
    }
  }

  const allVideoIds = trees.map((tree) => tree.videoId);
  const fallback = await getLeafNodesByVideoIds(allVideoIds, 6);
  return { sections: fallback };
}
