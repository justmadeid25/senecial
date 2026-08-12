/**
 * §Phase 14.1 - mirrors hybrid-search-scoring.ts exactly, for
 * ContractDocumentChunk. Kept as a separate parallel module (not a shared
 * generic over `contractClauseId`/`chunkId`) so the stable, heavily-used
 * clause scoring path is never touched by the new chunk retrieval leg -
 * same weights/bonus/version numbers, since both legs share the identical
 * keyword-stem + cosine-similarity signal shape and were calibrated
 * together against the same golden dataset.
 */
export interface DocumentChunkHybridSearchCandidate {
  chunkId: string;
  /** 0..1 - fraction of extracted keywords that matched this chunk's normalizedText. */
  keywordScore: number;
  /** -1..1 - raw cosine similarity between the query embedding and this chunk's embedding. */
  vectorScore: number;
}

export interface RankedDocumentChunkHybridResult extends DocumentChunkHybridSearchCandidate {
  score: number;
}

export const CHUNK_KEYWORD_WEIGHT = 0.6;
export const CHUNK_VECTOR_WEIGHT = 0.4;
export const CHUNK_EXACT_PHRASE_BONUS = 0.1;

/** §Phase 14.1 - identifies which chunk scoring/reranking formula produced a given cached result (mirrors SEARCH_WEIGHT_VERSION). Included in the chunk retrieval cache key. */
export const CHUNK_SEARCH_WEIGHT_VERSION = 1;

/** §Hybrid Search step 3 (Score Merge), chunk leg. Negative cosine scores clamp to 0, same rationale as mergeScores(). */
export function mergeChunkScores(
  candidates: DocumentChunkHybridSearchCandidate[]
): RankedDocumentChunkHybridResult[] {
  return candidates.map((candidate) => ({
    ...candidate,
    score: CHUNK_KEYWORD_WEIGHT * candidate.keywordScore + CHUNK_VECTOR_WEIGHT * Math.max(0, candidate.vectorScore),
  }));
}

/** §Hybrid Search step 4 (Rerank), chunk leg. Same exact-phrase-bonus heuristic as rerank(). */
export function rerankChunks(
  candidates: RankedDocumentChunkHybridResult[],
  exactPhraseMatchIds: ReadonlySet<string>
): RankedDocumentChunkHybridResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + (exactPhraseMatchIds.has(candidate.chunkId) ? CHUNK_EXACT_PHRASE_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score);
}
