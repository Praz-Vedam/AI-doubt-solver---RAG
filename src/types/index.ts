export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptSectionInput = {
  sectionTitle: string;
  startTime: number;
  endTime: number;
  transcript: string;
  pageLikeIndex: number;
};

export type SearchResultSection = {
  id: string;
  videoId: string;
  sectionTitle: string;
  startTime: number;
  endTime: number;
  transcript: string;
  pageLikeIndex: number;
  rank: number;
  videoTitle?: string;
};

export type ChatSource = {
  sectionId: string;
  timestamp: string;
  sectionTitle?: string;
  videoTitle?: string;
  videoId?: string;
};

export type TokenUsageInfo = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatResponse = {
  answer: string;
  confidence: number;
  sources: ChatSource[];
  sectionsUsed?: string[];
  usage?: TokenUsageInfo;
};

export type ChatMessageMetadata = {
  confidence?: number;
  sources?: ChatSource[];
  sectionsUsed?: string[];
};

export type IngestionProgressInfo = {
  stage: string;
  message: string;
  percent: number;
};

export type VideoSummary = {
  id: string;
  title: string;
  filename: string;
  duration: number | null;
  status: string;
  error: string | null;
  createdAt: string;
  sectionCount: number;
  progress?: IngestionProgressInfo | null;
};

export type TranscriptSectionView = {
  id: string;
  sectionTitle: string;
  startTime: number;
  endTime: number;
  transcript: string;
  pageLikeIndex: number;
};

export type TranscriptNodeView = {
  id: string;
  title: string;
  summary: string;
  text: string;
  startTime: number;
  endTime: number;
  depth: number;
  nodeIndex: number;
  children?: TranscriptNodeView[];
};

export type VideoTranscript = {
  videoId: string;
  title: string;
  status: string;
  nodeCount?: number;
  nodes: TranscriptNodeView[];
  sections?: TranscriptSectionView[];
};

export type FaqItem = {
  question: string;
  answer: string;
  videoTitle?: string;
  videoId?: string;
};

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "token"; content: string }
  | { type: "answer"; data: ChatResponse }
  | { type: "error"; message: string };
