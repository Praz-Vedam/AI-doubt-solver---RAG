import type { TranscriptSectionInput, TranscriptSegment } from "@/types";
import { countWords } from "@/lib/utils";

const MIN_WORDS = 500;
const MAX_WORDS = 1000;

function buildSectionTitle(segments: TranscriptSegment[], index: number): string {
  const preview = segments
    .slice(0, 2)
    .map((segment) => segment.text)
    .join(" ")
    .trim();

  const shortened = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
  return shortened ? `Section ${index + 1}: ${shortened}` : `Section ${index + 1}`;
}

export function chunkTranscript(segments: TranscriptSegment[]): TranscriptSectionInput[] {
  if (!segments.length) return [];

  const sections: TranscriptSectionInput[] = [];
  let currentSegments: TranscriptSegment[] = [];
  let currentWords = 0;
  let sectionIndex = 0;

  const flush = () => {
    if (!currentSegments.length) return;

    const transcript = currentSegments.map((segment) => segment.text).join(" ").trim();
    if (!transcript) {
      currentSegments = [];
      currentWords = 0;
      return;
    }

    sections.push({
      sectionTitle: buildSectionTitle(currentSegments, sectionIndex),
      startTime: currentSegments[0].start,
      endTime: currentSegments[currentSegments.length - 1].end,
      transcript,
      pageLikeIndex: sectionIndex,
    });

    sectionIndex += 1;
    currentSegments = [];
    currentWords = 0;
  };

  for (const segment of segments) {
    const segmentWords = countWords(segment.text);
    currentSegments.push(segment);
    currentWords += segmentWords;

    if (currentWords >= MIN_WORDS) {
      if (currentWords >= MAX_WORDS) {
        flush();
      }
    }
  }

  if (currentSegments.length) {
    if (sections.length && currentWords < MIN_WORDS) {
      const previous = sections[sections.length - 1];
      const mergedTranscript = `${previous.transcript} ${currentSegments.map((s) => s.text).join(" ")}`.trim();
      previous.transcript = mergedTranscript;
      previous.endTime = currentSegments[currentSegments.length - 1].end;
      previous.sectionTitle = buildSectionTitle(
        [
          { start: previous.startTime, end: previous.endTime, text: mergedTranscript.slice(0, 120) },
        ],
        previous.pageLikeIndex,
      );
    } else {
      flush();
    }
  }

  return sections.map((section, index) => ({
    ...section,
    pageLikeIndex: index,
    sectionTitle: section.sectionTitle.replace(/^Section \d+:/, `Section ${index + 1}:`),
  }));
}

function buildPlainSectionTitle(transcript: string, index: number): string {
  const shortened = transcript.length > 80 ? `${transcript.slice(0, 77)}...` : transcript;
  return shortened ? `Section ${index + 1}: ${shortened}` : `Section ${index + 1}`;
}

export function chunkPlainText(text: string): TranscriptSectionInput[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const sections: TranscriptSectionInput[] = [];
  let currentWords: string[] = [];
  let sectionIndex = 0;
  let timeOffset = 0;

  const flush = () => {
    if (!currentWords.length) return;

    const transcript = currentWords.join(" ").trim();
    if (!transcript) {
      currentWords = [];
      return;
    }

    const wordCount = currentWords.length;
    sections.push({
      sectionTitle: buildPlainSectionTitle(transcript, sectionIndex),
      startTime: timeOffset,
      endTime: timeOffset + wordCount,
      transcript,
      pageLikeIndex: sectionIndex,
    });

    timeOffset += wordCount;
    sectionIndex += 1;
    currentWords = [];
  };

  for (const word of words) {
    currentWords.push(word);

    if (currentWords.length >= MIN_WORDS && currentWords.length >= MAX_WORDS) {
      flush();
    }
  }

  if (currentWords.length) {
    if (sections.length && currentWords.length < MIN_WORDS) {
      const previous = sections[sections.length - 1];
      const mergedTranscript = `${previous.transcript} ${currentWords.join(" ")}`.trim();
      previous.transcript = mergedTranscript;
      previous.endTime = previous.startTime + countWords(mergedTranscript);
      previous.sectionTitle = buildPlainSectionTitle(mergedTranscript, previous.pageLikeIndex);
    } else {
      flush();
    }
  }

  return sections.map((section, index) => ({
    ...section,
    pageLikeIndex: index,
    sectionTitle: section.sectionTitle.replace(/^Section \d+:/, `Section ${index + 1}:`),
  }));
}
