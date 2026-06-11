import { prisma } from "@/lib/db";
import type { StoredTreeNode } from "@/services/tree-index";
import type { SearchResultSection, TranscriptNodeView } from "@/types";

type FlatNode = {
  id: string;
  videoId: string;
  parentId: string | null;
  title: string;
  summary: string;
  text: string;
  startTime: number;
  endTime: number;
  depth: number;
  nodeIndex: number;
  videoTitle?: string;
};

export type TreeSearchNode = {
  id: string;
  title: string;
  summary: string;
  videoId: string;
  videoTitle?: string;
  children?: TreeSearchNode[];
};

type DbClient = Pick<typeof prisma, "transcriptNode">;

async function insertNodeTree(
  tx: DbClient,
  videoId: string,
  nodes: StoredTreeNode[],
  parentId: string | null,
): Promise<void> {
  for (const node of nodes) {
    const created = await tx.transcriptNode.create({
      data: {
        videoId,
        parentId,
        title: node.title,
        summary: node.summary,
        text: node.text,
        startTime: node.startTime,
        endTime: node.endTime,
        depth: node.depth,
        nodeIndex: node.nodeIndex,
      },
    });

    if (node.children?.length) {
      await insertNodeTree(tx, videoId, node.children, created.id);
    }
  }
}

export async function storeTranscriptTree(
  videoId: string,
  nodes: StoredTreeNode[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.transcriptNode.deleteMany({ where: { videoId } });
    await tx.transcriptSection.deleteMany({ where: { videoId } });
    await insertNodeTree(tx, videoId, nodes, null);
  });
}

function buildNestedTree(flatNodes: FlatNode[]): TranscriptNodeView[] {
  const byParent = new Map<string | null, FlatNode[]>();

  for (const node of flatNodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const build = (parentId: string | null): TranscriptNodeView[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.nodeIndex - b.nodeIndex)
      .map((node) => ({
        id: node.id,
        title: node.title,
        summary: node.summary,
        text: node.text,
        startTime: node.startTime,
        endTime: node.endTime,
        depth: node.depth,
        nodeIndex: node.nodeIndex,
        children: build(node.id),
      }));

  return build(null);
}

export async function getVideoNodeTree(videoId: string): Promise<TranscriptNodeView[]> {
  const nodes = await prisma.transcriptNode.findMany({
    where: { videoId },
    orderBy: [{ depth: "asc" }, { nodeIndex: "asc" }],
  });

  return buildNestedTree(
    nodes.map((node) => ({
      id: node.id,
      videoId: node.videoId,
      parentId: node.parentId,
      title: node.title,
      summary: node.summary,
      text: node.text,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      nodeIndex: node.nodeIndex,
    })),
  );
}

export async function getSearchTrees(videoIds?: string[]): Promise<TreeSearchNode[]> {
  const videos = await prisma.video.findMany({
    where: {
      status: "READY",
      nodes: { some: {} },
      ...(videoIds?.length ? { id: { in: videoIds } } : {}),
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  if (!videos.length) return [];

  const nodes = await prisma.transcriptNode.findMany({
    where: { videoId: { in: videos.map((video) => video.id) } },
    orderBy: [{ videoId: "asc" }, { depth: "asc" }, { nodeIndex: "asc" }],
  });

  const titleByVideoId = new Map(videos.map((video) => [video.id, video.title]));
  const byVideo = new Map<string, FlatNode[]>();

  for (const node of nodes) {
    const bucket = byVideo.get(node.videoId) ?? [];
    bucket.push({
      id: node.id,
      videoId: node.videoId,
      parentId: node.parentId,
      title: node.title,
      summary: node.summary,
      text: node.text,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      nodeIndex: node.nodeIndex,
      videoTitle: titleByVideoId.get(node.videoId),
    });
    byVideo.set(node.videoId, bucket);
  }

  const trees: TreeSearchNode[] = [];

  for (const video of videos) {
    const flat = byVideo.get(video.id) ?? [];
    const nested = buildNestedTree(flat);

    const wrapAsVideoRoot: TreeSearchNode = {
      id: `video:${video.id}`,
      title: video.title,
      summary: `Lecture transcript with ${flat.length} indexed topic nodes.`,
      videoId: video.id,
      videoTitle: video.title,
      children: nested.map((node) => toSearchNode(node, video.id, video.title)),
    };

    trees.push(wrapAsVideoRoot);
  }

  return trees;
}

function toSearchNode(
  node: TranscriptNodeView,
  videoId: string,
  videoTitle: string,
): TreeSearchNode {
  return {
    id: node.id,
    title: node.title,
    summary: node.summary,
    videoId,
    videoTitle,
    children: node.children?.map((child) => toSearchNode(child, videoId, videoTitle)),
  };
}

function stripText(nodes: TreeSearchNode[]): Array<Record<string, unknown>> {
  return nodes.map((node) => ({
    id: node.id,
    title: node.title,
    summary: node.summary,
    videoId: node.videoId,
    videoTitle: node.videoTitle,
    children: node.children?.length ? stripText(node.children) : undefined,
  }));
}

export function buildTreeSearchPrompt(question: string, trees: TreeSearchNode[]): string {
  return `Question: ${question}

Document trees (titles and summaries only):
${JSON.stringify(stripText(trees), null, 2)}

Reply in JSON:
{
  "thinking": "<brief reasoning about which nodes are relevant>",
  "node_list": ["node_id_1", "node_id_2"]
}

Rules:
- Return only node ids from the tree above (not video:* ids).
- Pick 1 to 5 nodes most likely to contain the answer.
- Prefer specific leaf topics over broad parents when possible.
- If nothing is relevant, return an empty node_list.`;
}

async function getDescendantLeaves(nodeId: string): Promise<FlatNode[]> {
  const root = await prisma.transcriptNode.findUnique({
    where: { id: nodeId },
    select: { videoId: true },
  });

  if (!root) return [];

  const allNodes = await prisma.transcriptNode.findMany({
    where: { videoId: root.videoId },
    include: { video: { select: { title: true } } },
    orderBy: [{ depth: "asc" }, { nodeIndex: "asc" }],
  });

  const byParent = new Map<string | null, FlatNode[]>();
  for (const node of allNodes) {
    const flat: FlatNode = {
      id: node.id,
      videoId: node.videoId,
      parentId: node.parentId,
      title: node.title,
      summary: node.summary,
      text: node.text,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      nodeIndex: node.nodeIndex,
      videoTitle: node.video.title,
    };
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(flat);
    byParent.set(node.parentId, siblings);
  }

  const leaves: FlatNode[] = [];

  const walk = (id: string) => {
    const node = allNodes.find((item) => item.id === id);
    if (!node) return;

    const children = byParent.get(id) ?? [];
    if (!children.length) {
      leaves.push({
        id: node.id,
        videoId: node.videoId,
        parentId: node.parentId,
        title: node.title,
        summary: node.summary,
        text: node.text,
        startTime: node.startTime,
        endTime: node.endTime,
        depth: node.depth,
        nodeIndex: node.nodeIndex,
        videoTitle: node.video.title,
      });
      return;
    }

    for (const child of children) {
      walk(child.id);
    }
  };

  walk(nodeId);
  return leaves;
}

function toSearchResult(node: FlatNode, rank: number): SearchResultSection {
  return {
    id: node.id,
    videoId: node.videoId,
    sectionTitle: node.title,
    startTime: node.startTime,
    endTime: node.endTime,
    transcript: node.text || node.summary,
    pageLikeIndex: node.nodeIndex,
    rank,
    videoTitle: node.videoTitle,
  };
}

export async function nodesToSearchResults(nodeIds: string[]): Promise<SearchResultSection[]> {
  const uniqueIds = [...new Set(nodeIds.filter((id) => id && !id.startsWith("video:")))];
  if (!uniqueIds.length) return [];

  const results: SearchResultSection[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const nodeId = uniqueIds[index];
    const node = await prisma.transcriptNode.findUnique({
      where: { id: nodeId },
      include: { video: { select: { title: true, status: true } } },
    });

    if (!node || node.video.status !== "READY") continue;

    const flat: FlatNode = {
      id: node.id,
      videoId: node.videoId,
      parentId: node.parentId,
      title: node.title,
      summary: node.summary,
      text: node.text,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      nodeIndex: node.nodeIndex,
      videoTitle: node.video.title,
    };

    const candidates = node.text.trim() ? [flat] : await getDescendantLeaves(nodeId);

    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      results.push(toSearchResult(candidate, uniqueIds.length - index));
    }
  }

  return results;
}

export async function getLeafNodesByVideoIds(
  videoIds: string[],
  limit = 12,
): Promise<SearchResultSection[]> {
  if (!videoIds.length) return [];

  const nodes = await prisma.transcriptNode.findMany({
    where: {
      videoId: { in: videoIds },
      video: { status: "READY" },
    },
    include: { video: { select: { title: true } } },
    orderBy: [{ videoId: "asc" }, { depth: "desc" }, { nodeIndex: "asc" }],
    take: limit * 3,
  });

  const leaves = nodes.filter((node) => node.text.trim());

  return leaves.slice(0, limit).map((node, index) =>
    toSearchResult(
      {
        id: node.id,
        videoId: node.videoId,
        parentId: node.parentId,
        title: node.title,
        summary: node.summary,
        text: node.text,
        startTime: node.startTime,
        endTime: node.endTime,
        depth: node.depth,
        nodeIndex: node.nodeIndex,
        videoTitle: node.video.title,
      },
      leaves.length - index,
    ),
  );
}
