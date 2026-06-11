import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();

function formatTime(seconds) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const videos = await prisma.video.findMany({
  orderBy: { createdAt: "asc" },
  include: {
    nodes: {
      where: { depth: 0 },
      orderBy: { nodeIndex: "asc" },
    },
  },
});

let out = "\n## Transcripts (from DB)\n";

for (const video of videos) {
  out += `\n### ${video.title}\n`;
  for (const node of video.nodes) {
    out += `\n#### [${formatTime(node.startTime)} - ${formatTime(node.endTime)}] ${node.title}\n\n`;
    out += `${node.text.trim()}\n`;
  }
}

fs.appendFileSync("README.md", out);
console.log(`Appended transcripts for ${videos.length} video(s) to README.md`);

await prisma.$disconnect();
