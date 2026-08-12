import { encode } from "gpt-tokenizer";

import { detectClauseNumberLine } from "@/domain/clauses/clause-number-patterns";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";

/**
 * §Phase 14.1 §4 (Raw Document Chunking) - "raw document evidence" layer.
 * Splits a contract's FULL extracted text into boundary-aware,
 * token-budgeted chunks, independent of (and never dependent on) clause
 * segmentation succeeding - this is what lets AI retrieval recover a fact
 * clause extraction missed entirely (§11 Extraction Failure Resilience).
 *
 * Boundary priority (never a blind character cut):
 *   1. Article/heading lines (제N조...) - reuses
 *      domain/clauses/clause-number-patterns.ts's own detector, the same
 *      regex the clause segmenter already relies on, so heading detection
 *      never drifts between the two pipelines.
 *   2. Paragraph breaks (blank line).
 *   3. Sentence boundaries - only within a single paragraph that alone
 *      exceeds CHUNK_MAX_TOKENS (rare - a normal contract paragraph is
 *      nowhere near that large).
 *
 * No overlap between consecutive chunks in this version - a deliberate
 * simplicity choice (the spec allows omitting it: "필요하면 적절한
 * overlap을 사용하십시오"), not an oversight. If evaluation
 * (ai:evaluate/quality metrics) later shows real recall loss from facts
 * landing exactly on a chunk boundary, add bounded paragraph-level overlap
 * here - the chunk model has no schema constraint preventing overlapping
 * offset ranges.
 */

export const DOCUMENT_CHUNKER_VERSION = "boundary-aware-token-budget-v1";

/** Target chunk size - the spec's own "약 500~1,000 tokens/chunk" initial goal, using the low end so a chunk rarely needs the oversized-paragraph sentence-split fallback. */
export const CHUNK_TARGET_TOKENS = 600;
/** Hard ceiling - a single paragraph larger than this gets sentence-split rather than shipped as one oversized chunk. */
export const CHUNK_MAX_TOKENS = 1200;
/** Below this, a trailing tiny final chunk is merged into the previous one instead of standing alone (avoids a near-empty last chunk). */
const MIN_STANDALONE_CHUNK_TOKENS = 50;

export interface DocumentChunk {
  chunkIndex: number;
  text: string;
  normalizedText: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  headingContext: string | null;
}

interface RawParagraph {
  text: string;
  startOffset: number;
  endOffset: number;
  headingContext: string | null;
}

function tokenCount(text: string): number {
  return encode(text).length;
}

/** Splits on blank lines, tracking exact offsets and the most recent depth-0 (제N조) heading seen so far. Never drops content - leading/trailing whitespace-only gaps between paragraphs are simply not emitted as their own paragraph. */
function splitIntoParagraphs(text: string): RawParagraph[] {
  const paragraphs: RawParagraph[] = [];
  let currentHeading: string | null = null;
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    let blankLineAt = -1;
    let searchPos = pos;
    while (searchPos < len) {
      const lineEnd = text.indexOf("\n", searchPos);
      const line = text.slice(searchPos, lineEnd === -1 ? len : lineEnd);
      if (line.trim().length === 0 && searchPos > pos) {
        blankLineAt = searchPos;
        break;
      }
      if (lineEnd === -1) break;
      searchPos = lineEnd + 1;
    }
    const paragraphEnd = blankLineAt === -1 ? len : blankLineAt;
    const rawParagraph = text.slice(pos, paragraphEnd);
    const trimmedStart = rawParagraph.length - rawParagraph.trimStart().length;
    const trimmedText = rawParagraph.trim();

    if (trimmedText.length > 0) {
      const startOffset = pos + trimmedStart;
      const endOffset = startOffset + trimmedText.length;
      const firstLine = trimmedText.split("\n", 1)[0]!;
      const headingMatch = detectClauseNumberLine(firstLine);
      if (headingMatch && headingMatch.depth === 0) {
        currentHeading = headingMatch.title
          ? `${headingMatch.clauseNumber}(${headingMatch.title})`
          : headingMatch.clauseNumber;
      }
      paragraphs.push({ text: trimmedText, startOffset, endOffset, headingContext: currentHeading });
    }

    pos = paragraphEnd;
    while (pos < len && text[pos] === "\n") pos += 1;
  }

  return paragraphs;
}

/** Sentence-level fallback split for a single paragraph that alone exceeds CHUNK_MAX_TOKENS. Splits after '.', '!', '?' (Korean formal contract prose ends sentences with these same marks) followed by whitespace or end of string. */
function splitParagraphIntoSentenceChunks(paragraph: RawParagraph): RawParagraph[] {
  const sentenceBoundary = /(?<=[.!?])\s+/g;
  const pieces: Array<{ text: string; start: number }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceBoundary.exec(paragraph.text)) !== null) {
    pieces.push({ text: paragraph.text.slice(lastIndex, match.index), start: lastIndex });
    lastIndex = sentenceBoundary.lastIndex;
  }
  pieces.push({ text: paragraph.text.slice(lastIndex), start: lastIndex });

  const result: RawParagraph[] = [];
  let bucket = "";
  let bucketStart = 0;
  for (const piece of pieces) {
    const candidate = bucket ? `${bucket} ${piece.text}` : piece.text;
    if (bucket && tokenCount(candidate) > CHUNK_MAX_TOKENS) {
      result.push({
        text: bucket,
        startOffset: paragraph.startOffset + bucketStart,
        endOffset: paragraph.startOffset + bucketStart + bucket.length,
        headingContext: paragraph.headingContext,
      });
      bucket = piece.text;
      bucketStart = piece.start;
    } else {
      bucket = candidate;
    }
  }
  if (bucket.trim().length > 0) {
    result.push({
      text: bucket,
      startOffset: paragraph.startOffset + bucketStart,
      endOffset: paragraph.startOffset + bucketStart + bucket.length,
      headingContext: paragraph.headingContext,
    });
  }
  return result.length > 0 ? result : [paragraph];
}

/**
 * Chunks `documentText` (a ContractExtractedDocument.text value) into
 * boundary-aware, token-budgeted DocumentChunk records. Deterministic and
 * pure - no I/O, no DB access - callers persist the result.
 */
export function chunkDocumentText(documentText: string): DocumentChunk[] {
  if (documentText.trim().length === 0) {
    return [];
  }

  const rawParagraphs = splitIntoParagraphs(documentText);
  const normalizedParagraphs: RawParagraph[] = [];
  for (const paragraph of rawParagraphs) {
    if (tokenCount(paragraph.text) > CHUNK_MAX_TOKENS) {
      normalizedParagraphs.push(...splitParagraphIntoSentenceChunks(paragraph));
    } else {
      normalizedParagraphs.push(paragraph);
    }
  }

  const chunks: DocumentChunk[] = [];
  let bucket: RawParagraph[] = [];
  let bucketTokens = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const startOffset = bucket[0]!.startOffset;
    const endOffset = bucket[bucket.length - 1]!.endOffset;
    const text = documentText.slice(startOffset, endOffset);
    chunks.push({
      chunkIndex: chunks.length,
      text,
      normalizedText: normalizeClauseText(text),
      tokenCount: tokenCount(text),
      startOffset,
      endOffset,
      // The LAST paragraph's heading, not the first: a chunk spanning
      // multiple short articles should point a citation reader at
      // whichever article the chunk's content is actually closest to -
      // its own tail end, not a stale heading from several articles ago.
      headingContext: bucket[bucket.length - 1]!.headingContext,
    });
    bucket = [];
    bucketTokens = 0;
  };

  for (const paragraph of normalizedParagraphs) {
    const paragraphTokens = tokenCount(paragraph.text);
    if (bucket.length > 0 && bucketTokens + paragraphTokens > CHUNK_TARGET_TOKENS) {
      flush();
    }
    bucket.push(paragraph);
    bucketTokens += paragraphTokens;
  }
  flush();

  // Merge a too-small trailing chunk into its predecessor rather than
  // shipping a near-empty last chunk - only when there IS a predecessor
  // (a single small document legitimately stays as one small chunk).
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]!;
    if (last.tokenCount < MIN_STANDALONE_CHUNK_TOKENS) {
      const prev = chunks[chunks.length - 2]!;
      const mergedText = documentText.slice(prev.startOffset, last.endOffset);
      chunks.splice(chunks.length - 2, 2, {
        chunkIndex: prev.chunkIndex,
        text: mergedText,
        normalizedText: normalizeClauseText(mergedText),
        tokenCount: tokenCount(mergedText),
        startOffset: prev.startOffset,
        endOffset: last.endOffset,
        // Same "most recent heading" principle as flush() above.
        headingContext: last.headingContext ?? prev.headingContext,
      });
    }
  }

  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}
