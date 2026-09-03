import type { ChunkCitation, ClauseCitation } from "./citation";
import { extractChunkEvidence, extractEvidenceSentence } from "./evidence-sentence";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";

export interface SearchResultLike {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  score: number;
}

const FALLBACK_CLAUSE_REFERENCE = "조항 번호 미상";

/** §Context Builder - one hybrid-search (clause) result -> one fully-populated ClauseCitation, never a partial one. */
export function buildContext(result: SearchResultLike, question: string): ClauseCitation {
  return {
    evidenceType: "clause",
    contractClauseId: result.contractClauseId,
    chunkId: null,
    contractId: result.contractId,
    contractTitle: result.contractTitle,
    clauseReference: result.clauseNumber ?? result.title ?? FALLBACK_CLAUSE_REFERENCE,
    evidenceText: extractEvidenceSentence(result.text, question),
    score: result.score,
  };
}

export interface ChunkSearchResultLike {
  chunkId: string;
  contractId: string;
  contractTitle: string;
  chunkIndex: number;
  headingContext: string | null;
  text: string;
  startOffset: number;
  endOffset: number;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  score: number;
}

/**
 * §Phase 14.1 §4/§10 - one raw-document chunk hybrid-search result -> one
 * fully-populated ChunkCitation. `clauseReference` mirrors buildContext()'s
 * "never empty" contract, otherwise a positional fallback distinguishable
 * from a real clause number - a reader (or the citation-required marker
 * matcher, which only compares text) must never confuse "본문 발췌 3" with
 * an actual 제N조 reference.
 *
 * §AI 답변 품질 개편 P0-3 (citation correctness fix) - `clauseReference`
 * and `evidenceText` are now derived TOGETHER by extractChunkEvidence(),
 * not independently: a chunk's stored `headingContext` (fixed at ingestion
 * time to the chunk's LAST article - see document-chunker.ts) is only a
 * FALLBACK here, used when no heading precedes the actually-selected
 * evidence sentence within this chunk. When a chunk spans multiple short
 * articles and the query's best-matching sentence comes from an EARLIER
 * article than the chunk's tail, the citation now correctly labels that
 * earlier article instead of silently mislabeling it with the chunk's
 * last heading (previously: `result.headingContext` and
 * `extractEvidenceSentence(result.text, question)` were computed
 * completely independently, so the displayed heading and the quoted
 * sentence could - and did - come from two different articles).
 */
export function buildChunkContext(result: ChunkSearchResultLike, question: string): ChunkCitation {
  const fallbackHeading = result.headingContext ?? `본문 발췌 ${result.chunkIndex + 1}`;
  const { evidenceText, headingContext } = extractChunkEvidence(result.text, question, fallbackHeading);
  return {
    evidenceType: "chunk",
    contractClauseId: null,
    chunkId: result.chunkId,
    contractId: result.contractId,
    contractTitle: result.contractTitle,
    clauseReference: headingContext ?? fallbackHeading,
    evidenceText,
    score: result.score,
    sourcePageStart: result.sourcePageStart,
    sourcePageEnd: result.sourcePageEnd,
    chunkStartOffset: result.startOffset,
    chunkEndOffset: result.endOffset,
  };
}

/**
 * §Retrieval "Deduplicate" - collapses near-duplicate clauses (the exact
 * same boilerplate text repeated verbatim across several contracts - a
 * common real occurrence for standard clauses) down to the single
 * highest-scored occurrence, so the LLM is never handed the same
 * evidence sentence 3 times under 3 different contract names. Comparison
 * is on normalized text (whitespace/case-insensitive), not raw text.
 * `results` MUST already be sorted by score descending (hybridSearchClauses'
 * own contract) - the FIRST occurrence of each normalized text is kept.
 */
export function deduplicateByNormalizedText<T extends { text: string }>(results: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const result of results) {
    const key = normalizeClauseText(result.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}
