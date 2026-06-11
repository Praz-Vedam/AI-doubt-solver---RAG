-- CreateTable
CREATE TABLE "TranscriptNode" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "depth" INTEGER NOT NULL,
    "nodeIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranscriptNode_videoId_idx" ON "TranscriptNode"("videoId");

-- CreateIndex
CREATE INDEX "TranscriptNode_parentId_idx" ON "TranscriptNode"("parentId");

-- CreateIndex
CREATE INDEX "TranscriptNode_videoId_depth_idx" ON "TranscriptNode"("videoId", "depth");

-- CreateIndex
CREATE INDEX "TranscriptNode_videoId_nodeIndex_idx" ON "TranscriptNode"("videoId", "nodeIndex");

-- AddForeignKey
ALTER TABLE "TranscriptNode" ADD CONSTRAINT "TranscriptNode_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptNode" ADD CONSTRAINT "TranscriptNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TranscriptNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
