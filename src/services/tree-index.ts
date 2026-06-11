import { completeJson } from "@/services/llm";
import type { TranscriptSegment } from "@/types";

const TARGET_BLOCK_SECONDS = 120;
// ~150 wpm; used when transcript segments lack usable timestamps.
const ESTIMATED_WORDS_PER_SECOND = 2.5;
// Above this block count, indexing switches to map-reduce (windowed) mode.
const SINGLE_SHOT_MAX_BLOCKS = 32;
// Truncation applies ONLY to text sent to LLM prompts; stored node text is
// always the full transcript.
const SINGLE_SHOT_EXCERPT_CHARS = 600;
const MAP_EXCERPT_CHARS = 2400;
const WINDOW_BLOCKS = 6; // ~12 min of speech per map call
const MAX_WINDOWS = 48;
const MAP_CONCURRENCY = 2;

export type TimedBlock = {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
};

type TreeNodeDraft = {
  title: string;
  summary: string;
  blockIds?: number[];
  children?: TreeNodeDraft[];
};

export type StoredTreeNode = {
  title: string;
  summary: string;
  text: string;
  startTime: number;
  endTime: number;
  depth: number;
  nodeIndex: number;
  children?: StoredTreeNode[];
};

function hasMeaningfulTimestamps(segments: TranscriptSegment[]): boolean {
  if (!segments.length) return false;

  const span =
    Math.max(...segments.map((segment) => segment.end)) -
    Math.min(...segments.map((segment) => segment.start));

  if (span < 30) return false;

  return segments.some((segment) => segment.end > segment.start);
}

function textToTimedBlocks(text: string, targetDurationSec: number): TimedBlock[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const wordsPerBlock = Math.max(50, Math.round(targetDurationSec * ESTIMATED_WORDS_PER_SECOND));
  const blocks: TimedBlock[] = [];

  for (let i = 0; i < words.length; i += wordsPerBlock) {
    const chunkWords = words.slice(i, i + wordsPerBlock);
    const startTime = i / ESTIMATED_WORDS_PER_SECOND;
    const endTime = Math.min(
      (i + chunkWords.length) / ESTIMATED_WORDS_PER_SECOND,
      words.length / ESTIMATED_WORDS_PER_SECOND,
    );

    blocks.push({
      id: blocks.length,
      startTime,
      endTime,
      text: chunkWords.join(" "),
    });
  }

  return blocks;
}

export function segmentsToTimedBlocks(
  segments: TranscriptSegment[],
  targetDurationSec = TARGET_BLOCK_SECONDS,
): TimedBlock[] {
  if (!segments.length) return [];

  if (!hasMeaningfulTimestamps(segments)) {
    const text = segments.map((segment) => segment.text).join(" ").trim();
    return textToTimedBlocks(text, targetDurationSec);
  }

  const blocks: TimedBlock[] = [];
  let currentSegments: TranscriptSegment[] = [];
  let blockStart = segments[0].start;

  const flush = (endTime: number) => {
    if (!currentSegments.length) return;

    const text = currentSegments.map((segment) => segment.text).join(" ").trim();
    if (!text) {
      currentSegments = [];
      return;
    }

    // Blocks keep the FULL text: this is what gets stored in TranscriptNode.
    blocks.push({
      id: blocks.length,
      startTime: blockStart,
      endTime,
      text,
    });
    currentSegments = [];
  };

  for (const segment of segments) {
    if (!currentSegments.length) {
      blockStart = segment.start;
    }

    currentSegments.push(segment);
    const duration = segment.end - blockStart;

    if (duration >= targetDurationSec) {
      flush(segment.end);
      blockStart = segment.end;
    }
  }

  if (currentSegments.length) {
    flush(currentSegments[currentSegments.length - 1].end);
  }

  return blocks;
}

export function plainTextToSegments(text: string): TranscriptSegment[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const wordsPerSegment = 25;
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < words.length; i += wordsPerSegment) {
    const chunk = words.slice(i, i + wordsPerSegment).join(" ");
    segments.push({
      start: i,
      end: i + wordsPerSegment,
      text: chunk,
    });
  }

  return segments;
}

function truncateExcerpt(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function blocksForPrompt(blocks: TimedBlock[], maxChars: number) {
  return blocks.map((block) => ({
    id: block.id,
    startTime: block.startTime,
    endTime: block.endTime,
    excerpt: truncateExcerpt(block.text, maxChars),
  }));
}

function collectBlockIds(node: TreeNodeDraft): number[] {
  if (node.blockIds?.length) {
    return [...node.blockIds];
  }

  return (node.children ?? []).flatMap((child) => collectBlockIds(child));
}

function resolveNode(
  draft: TreeNodeDraft,
  blocks: TimedBlock[],
  depth: number,
  nodeIndex: number,
): StoredTreeNode | null {
  const blockIds = collectBlockIds(draft);
  const usedBlocks = blockIds
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is TimedBlock => Boolean(block));

  const children = (draft.children ?? [])
    .map((child, index) => resolveNode(child, blocks, depth + 1, index))
    .filter((child): child is StoredTreeNode => Boolean(child));

  const text = usedBlocks.map((block) => block.text).join(" ").trim();
  const startTime = usedBlocks[0]?.startTime ?? children[0]?.startTime ?? 0;
  const endTime =
    usedBlocks[usedBlocks.length - 1]?.endTime ??
    children[children.length - 1]?.endTime ??
    startTime;

  if (!text && !children.length) {
    return null;
  }

  return {
    title: draft.title.trim() || `Topic ${nodeIndex + 1}`,
    summary: draft.summary.trim() || draft.title.trim(),
    text,
    startTime,
    endTime,
    depth,
    nodeIndex,
    children: children.length ? children : undefined,
  };
}

function fallbackTree(blocks: TimedBlock[]): StoredTreeNode[] {
  const chunkSize = Math.max(1, Math.ceil(blocks.length / 6));

  return blocks
    .reduce<StoredTreeNode[]>((nodes, block, index) => {
      if (index % chunkSize !== 0) return nodes;

      const group = blocks.slice(index, index + chunkSize);
      const text = group.map((item) => item.text).join(" ").trim();
      const titleWords = text.split(/\s+/).slice(0, 8).join(" ");

      nodes.push({
        title: titleWords ? `Topic: ${titleWords}` : `Topic ${nodes.length + 1}`,
        summary: text.slice(0, 220),
        text,
        startTime: group[0].startTime,
        endTime: group[group.length - 1].endTime,
        depth: 0,
        nodeIndex: nodes.length,
      });

      return nodes;
    }, []);
}

async function generateTreeDraft(
  blocks: TimedBlock[],
  title: string,
): Promise<TreeNodeDraft[]> {
  const result = await completeJson<{ nodes: TreeNodeDraft[] }>({
    system: `You build a hierarchical topic index (PageIndex-style) for a lecture transcript.
Return JSON: {"nodes": [{"title": string, "summary": string, "blockIds"?: number[], "children"?: [...]}]}

Rules:
- Create 4 to 8 top-level topics in chronological order.
- Add children only when a topic clearly has distinct subtopics (max 3 children per parent).
- Leaf nodes must include "blockIds" referencing transcript blocks. Every block id must appear exactly once across all leaves.
- Parent nodes with children should not include blockIds; use children instead.
- Summaries are 1-2 factual sentences grounded in the assigned blocks.
- Titles are short, specific, and student-friendly.
- Do not invent content beyond the provided blocks.`,
    user: `Lecture title: ${title}

Transcript blocks:
${JSON.stringify(blocksForPrompt(blocks, SINGLE_SHOT_EXCERPT_CHARS), null, 2)}`,
    temperature: 0.2,
    role: "index",
  });

  return result.nodes ?? [];
}

type LeafDraft = {
  title: string;
  summary: string;
  blockIds: number[];
};

function fallbackLeafForWindow(windowBlocks: TimedBlock[]): LeafDraft {
  const text = windowBlocks.map((block) => block.text).join(" ").trim();
  const titleWords = text.split(/\s+/).slice(0, 8).join(" ");
  return {
    title: titleWords ? `Topic: ${titleWords}` : "Untitled topic",
    summary: text.slice(0, 220),
    blockIds: windowBlocks.map((block) => block.id),
  };
}

async function generateWindowLeaves(
  windowBlocks: TimedBlock[],
  title: string,
  windowIndex: number,
  totalWindows: number,
): Promise<LeafDraft[]> {
  const validIds = new Set(windowBlocks.map((block) => block.id));

  let drafts: LeafDraft[];
  try {
    const result = await completeJson<{ nodes: LeafDraft[] }>({
      system: `You index one portion of a longer lecture transcript.
Return JSON: {"nodes": [{"title": string, "summary": string, "blockIds": number[]}]}

Rules:
- Create 2 to 4 topic nodes in chronological order covering this portion.
- Every provided block id must appear in exactly one node's blockIds.
- Summaries are 1-2 factual sentences grounded ONLY in the block excerpts.
- Titles are short, specific, and student-friendly.
- Do not invent content beyond the provided blocks.`,
      user: `Lecture title: ${title}
This is portion ${windowIndex + 1} of ${totalWindows}.

Transcript blocks:
${JSON.stringify(blocksForPrompt(windowBlocks, MAP_EXCERPT_CHARS), null, 2)}`,
      temperature: 0.2,
      role: "index",
    });
    drafts = result.nodes ?? [];
  } catch {
    return [fallbackLeafForWindow(windowBlocks)];
  }

  const used = new Set<number>();
  const leaves = drafts
    .map((draft) => ({
      title: (draft.title ?? "").trim(),
      summary: (draft.summary ?? "").trim(),
      blockIds: (draft.blockIds ?? []).filter((id) => {
        if (!validIds.has(id) || used.has(id)) return false;
        used.add(id);
        return true;
      }),
    }))
    .filter((leaf) => leaf.blockIds.length > 0);

  if (!leaves.length) {
    return [fallbackLeafForWindow(windowBlocks)];
  }

  // Attach any blocks the LLM dropped to the chronologically nearest leaf.
  for (const block of windowBlocks) {
    if (used.has(block.id)) continue;
    const target =
      leaves.find((leaf) => Math.min(...leaf.blockIds) > block.id) ?? leaves[leaves.length - 1];
    target.blockIds.push(block.id);
    target.blockIds.sort((a, b) => a - b);
  }

  return leaves;
}

type ChapterDraft = {
  title: string;
  summary: string;
  leafIds: number[];
};

async function groupLeavesIntoChapters(
  leaves: LeafDraft[],
  title: string,
): Promise<ChapterDraft[] | null> {
  try {
    const result = await completeJson<{ chapters: ChapterDraft[] }>({
      system: `You organize a chronological list of lecture topic nodes into top-level chapters.
Return JSON: {"chapters": [{"title": string, "summary": string, "leafIds": number[]}]}

Rules:
- Create 4 to 8 chapters in chronological order.
- Every leaf id must appear in exactly one chapter's leafIds.
- Chapter summaries are 1-2 sentences synthesizing their leaves.
- Titles are short, specific, and student-friendly.`,
      user: `Lecture title: ${title}

Topic nodes (chronological):
${JSON.stringify(
        leaves.map((leaf, index) => ({ id: index, title: leaf.title, summary: leaf.summary })),
        null,
        2,
      )}`,
      temperature: 0.2,
      role: "index",
    });

    const chapters = result.chapters ?? [];
    if (!chapters.length) return null;

    const used = new Set<number>();
    const cleaned = chapters
      .map((chapter) => ({
        title: (chapter.title ?? "").trim(),
        summary: (chapter.summary ?? "").trim(),
        leafIds: (chapter.leafIds ?? []).filter((id) => {
          if (!Number.isInteger(id) || id < 0 || id >= leaves.length || used.has(id)) return false;
          used.add(id);
          return true;
        }),
      }))
      .filter((chapter) => chapter.leafIds.length > 0);

    if (!cleaned.length) return null;

    for (let id = 0; id < leaves.length; id += 1) {
      if (used.has(id)) continue;
      const target =
        cleaned.find((chapter) => Math.min(...chapter.leafIds) > id) ?? cleaned[cleaned.length - 1];
      target.leafIds.push(id);
      target.leafIds.sort((a, b) => a - b);
    }

    return cleaned.sort((a, b) => Math.min(...a.leafIds) - Math.min(...b.leafIds));
  } catch {
    return null;
  }
}

function leafToStoredNode(
  leaf: LeafDraft,
  blocks: TimedBlock[],
  depth: number,
  nodeIndex: number,
): StoredTreeNode {
  const leafBlocks = leaf.blockIds
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is TimedBlock => Boolean(block));

  return {
    title: leaf.title || `Topic ${nodeIndex + 1}`,
    summary: leaf.summary || leaf.title,
    text: leafBlocks.map((block) => block.text).join(" ").trim(),
    startTime: leafBlocks[0]?.startTime ?? 0,
    endTime: leafBlocks[leafBlocks.length - 1]?.endTime ?? 0,
    depth,
    nodeIndex,
  };
}

// Map-reduce indexing for long transcripts: one cheap "index" LLM call per
// ~12 min window over (near) full text, then one call to group the resulting
// leaves into chapters. Avoids both context overflow and excerpt starvation
// of the old single-shot 32-block approach.
async function buildTreeMapReduce(
  blocks: TimedBlock[],
  title: string,
  onProgress?: IndexingProgress,
): Promise<StoredTreeNode[]> {
  const windowSize = Math.max(WINDOW_BLOCKS, Math.ceil(blocks.length / MAX_WINDOWS));
  const windows: TimedBlock[][] = [];
  for (let i = 0; i < blocks.length; i += windowSize) {
    windows.push(blocks.slice(i, i + windowSize));
  }

  // +1 step for the final reduce (chapter grouping) call.
  const totalSteps = windows.length + 1;
  let doneSteps = 0;
  onProgress?.(0, totalSteps);

  const leavesByWindow: LeafDraft[][] = new Array(windows.length);
  for (let i = 0; i < windows.length; i += MAP_CONCURRENCY) {
    const batch = windows.slice(i, i + MAP_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (windowBlocks, offset) => {
        const leaves = await generateWindowLeaves(windowBlocks, title, i + offset, windows.length);
        doneSteps += 1;
        onProgress?.(doneSteps, totalSteps);
        return leaves;
      }),
    );
    results.forEach((leaves, offset) => {
      leavesByWindow[i + offset] = leaves;
    });
  }

  const leaves = leavesByWindow.flat();
  if (!leaves.length) {
    return fallbackTree(blocks);
  }

  const chapters = await groupLeavesIntoChapters(leaves, title);
  onProgress?.(totalSteps, totalSteps);
  if (!chapters) {
    return leaves.map((leaf, index) => leafToStoredNode(leaf, blocks, 0, index));
  }

  return chapters.map((chapter, chapterIndex) => {
    const children = chapter.leafIds.map((leafId, childIndex) =>
      leafToStoredNode(leaves[leafId], blocks, 1, childIndex),
    );

    return {
      title: chapter.title || `Chapter ${chapterIndex + 1}`,
      summary: chapter.summary || chapter.title,
      text: "",
      startTime: children[0]?.startTime ?? 0,
      endTime: children[children.length - 1]?.endTime ?? 0,
      depth: 0,
      nodeIndex: chapterIndex,
      children,
    };
  });
}

export type IndexingProgress = (done: number, total: number) => void;

export async function buildTranscriptTree(
  segments: TranscriptSegment[],
  title: string,
  onProgress?: IndexingProgress,
): Promise<StoredTreeNode[]> {
  const blocks = segmentsToTimedBlocks(segments);
  if (!blocks.length) return [];

  if (blocks.length > SINGLE_SHOT_MAX_BLOCKS) {
    return buildTreeMapReduce(blocks, title, onProgress);
  }

  onProgress?.(0, 1);
  try {
    const draft = await generateTreeDraft(blocks, title);
    const nodes = draft
      .map((node, index) => resolveNode(node, blocks, 0, index))
      .filter((node): node is StoredTreeNode => Boolean(node));

    if (nodes.length) {
      onProgress?.(1, 1);
      return nodes;
    }
  } catch {
    // Fall through to heuristic tree.
  }

  onProgress?.(1, 1);
  return fallbackTree(blocks);
}
