import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { SearchResultSection } from "@/types";

type RawSearchRow = {
  id: string;
  videoId: string;
  sectionTitle: string;
  startTime: number;
  endTime: number;
  transcript: string;
  pageLikeIndex: number;
  rank: number;
  videoTitle: string | null;
};

export async function searchTranscriptSections(
  query: string,
  limit = 20,
  videoIds?: string[],
): Promise<SearchResultSection[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const videoFilter =
    videoIds && videoIds.length
      ? `AND ts."videoId" = ANY(ARRAY[${videoIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[])`
      : "";

  const rows = await prisma.$queryRawUnsafe<RawSearchRow[]>(
    `
    SELECT
      ts."id",
      ts."videoId",
      ts."sectionTitle",
      ts."startTime",
      ts."endTime",
      ts."transcript",
      ts."pageLikeIndex",
      ts_rank(ts."searchVector", plainto_tsquery('english', $1)) AS rank,
      v."title" AS "videoTitle"
    FROM "TranscriptSection" ts
    JOIN "Video" v ON v."id" = ts."videoId"
    WHERE ts."searchVector" @@ plainto_tsquery('english', $1)
      AND v."status" = 'READY'
      ${videoFilter}
    ORDER BY rank DESC
    LIMIT $2
    `,
    normalized,
    limit,
  );

  return rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    sectionTitle: row.sectionTitle,
    startTime: row.startTime,
    endTime: row.endTime,
    transcript: row.transcript,
    pageLikeIndex: row.pageLikeIndex,
    rank: Number(row.rank),
    videoTitle: row.videoTitle ?? undefined,
  }));
}

export async function searchWithMultipleQueries(
  queries: string[],
  limit = 20,
  videoIds?: string[],
): Promise<SearchResultSection[]> {
  const uniqueQueries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  const merged = new Map<string, SearchResultSection>();

  for (const query of uniqueQueries) {
    const results = await searchTranscriptSections(query, limit, videoIds);
    for (const result of results) {
      const existing = merged.get(result.id);
      if (!existing || result.rank > existing.rank) {
        merged.set(result.id, result);
      }
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

export async function getSectionsByVideoIds(
  videoIds: string[],
  limit = 8,
): Promise<SearchResultSection[]> {
  if (!videoIds.length) return [];

  const sections = await prisma.transcriptSection.findMany({
    where: { videoId: { in: videoIds } },
    include: { video: { select: { title: true, status: true } } },
    orderBy: [{ videoId: "asc" }, { pageLikeIndex: "asc" }],
    take: limit,
  });

  return sections
    .filter((section) => section.video.status === "READY")
    .map((section) => ({
      id: section.id,
      videoId: section.videoId,
      sectionTitle: section.sectionTitle,
      startTime: section.startTime,
      endTime: section.endTime,
      transcript: section.transcript,
      pageLikeIndex: section.pageLikeIndex,
      rank: 1,
      videoTitle: section.video.title,
    }));
}

export async function getSectionsByTitleMention(
  question: string,
  videoIds?: string[],
  limit = 8,
): Promise<SearchResultSection[]> {
  const videos = await prisma.video.findMany({
    where: {
      status: "READY",
      sections: { some: {} },
      ...(videoIds?.length ? { id: { in: videoIds } } : {}),
    },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  if (!videos.length) return [];

  const normalizedQuestion = question.toLowerCase();
  const quotedTitle = question.match(/"([^"]+)"/)?.[1]?.trim().toLowerCase();

  const matchedVideoIds = videos
    .filter((video) => {
      const title = video.title.toLowerCase();
      if (quotedTitle && title === quotedTitle) return true;
      if (quotedTitle && title.includes(quotedTitle)) return true;
      return normalizedQuestion.includes(title);
    })
    .map((video) => video.id);

  if (!matchedVideoIds.length) return [];

  const sections = await prisma.transcriptSection.findMany({
    where: { videoId: { in: matchedVideoIds } },
    include: { video: { select: { title: true, status: true } } },
    orderBy: [{ videoId: "asc" }, { pageLikeIndex: "asc" }],
    take: limit,
  });

  return sections
    .filter((section) => section.video.status === "READY")
    .map((section) => ({
      id: section.id,
      videoId: section.videoId,
      sectionTitle: section.sectionTitle,
      startTime: section.startTime,
      endTime: section.endTime,
      transcript: section.transcript,
      pageLikeIndex: section.pageLikeIndex,
      rank: 1,
      videoTitle: section.video.title,
    }));
}

export async function getSectionsByIds(ids: string[]): Promise<SearchResultSection[]> {
  if (!ids.length) return [];

  const sections = await prisma.transcriptSection.findMany({
    where: { id: { in: ids } },
    include: { video: { select: { title: true, status: true } } },
    orderBy: [{ videoId: "asc" }, { pageLikeIndex: "asc" }],
  });

  return sections
    .filter((section) => section.video.status === "READY")
    .map((section) => ({
      id: section.id,
      videoId: section.videoId,
      sectionTitle: section.sectionTitle,
      startTime: section.startTime,
      endTime: section.endTime,
      transcript: section.transcript,
      pageLikeIndex: section.pageLikeIndex,
      rank: 0,
      videoTitle: section.video.title,
    }));
}

export async function storeTranscriptSections(
  videoId: string,
  sections: Array<{
    sectionTitle: string;
    startTime: number;
    endTime: number;
    transcript: string;
    pageLikeIndex: number;
  }>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.transcriptSection.deleteMany({ where: { videoId } });

    for (const section of sections) {
      await tx.$executeRawUnsafe(
        `
        INSERT INTO "TranscriptSection" (
          "id", "videoId", "sectionTitle", "startTime", "endTime", "transcript", "pageLikeIndex", "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW()
        )
        `,
        randomUUID(),
        videoId,
        section.sectionTitle,
        section.startTime,
        section.endTime,
        section.transcript,
        section.pageLikeIndex,
      );
    }
  });
}
