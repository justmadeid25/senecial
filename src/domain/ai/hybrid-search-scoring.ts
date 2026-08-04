/**
 * Phase 12 Part B - pure score-merge + rerank logic, kept separate from
 * any DB/provider call so it is trivially unit-testable in isolation (see
 * tests/unit/hybrid-search-scoring.test.ts).
 */
export interface HybridSearchCandidate {
  contractClauseId: string;
  /** 0..1 - fraction of extracted keywords that matched this clause's normalizedText. */
  keywordScore: number;
  /** -1..1 - raw cosine similarity between the query embedding and this clause's embedding. */
  vectorScore: number;
}

export interface RankedHybridResult extends HybridSearchCandidate {
  score: number;
}

/**
 * Keyword-stem overlap is weighted higher than raw vector cosine
 * similarity - the char-trigram hashing-trick embedding (the pgvector-free
 * fallback; see hashing-trick-embedding.ts) is a genuinely weak signal for
 * short Korean paraphrases that share a topic but few literal characters
 * (e.g. "손해배상 책임은 어떻게 되나요?" vs. a clause reading "...그 손해를
 * 배상하여야 한다" - the correct match, but only a modest trigram overlap).
 * The evaluation CLI's golden dataset (Phase 12 Part L,
 * tests/integration/ai-evaluation.test.ts) caught this concretely: under
 * an earlier 0.4/0.6 split, a real answerable question's own top-ranked
 * (and correct) result scored LOWER than an unrelated question's pure
 * vector-noise result on a different document, which the hallucination
 * guard's threshold could not separate no matter where it was set. A
 * 0.6/0.4 split (keyword-favored) fixes this without regressing the
 * existing true-positive cases (see MIN_CITATION_SCORE's own comment).
 */
export const KEYWORD_WEIGHT = 0.6;
export const VECTOR_WEIGHT = 0.4;
export const EXACT_PHRASE_BONUS = 0.1;

/**
 * §Phase 12.2 Part C - rerank() below is a real, deliberate heuristic (an
 * exact-phrase-match bonus), not a placeholder for a future cross-encoder
 * reranker - this identifies WHICH heuristic is live, the same way
 * SEARCH_WEIGHT_VERSION identifies which merge weights are live. Bump this
 * (and AI_CONFIG_VERSION in ai-runtime-configuration.ts) if the reranking
 * heuristic itself ever changes shape, independently of a pure weight retune.
 */
export const RERANKER_VERSION = "exact-phrase-bonus-v1";

/**
 * §Phase 12.1 Part 15 (Cache) - bump this whenever KEYWORD_WEIGHT,
 * VECTOR_WEIGHT, or EXACT_PHRASE_BONUS change. A cached retrieval result
 * computed under a previous weighting is not just "possibly stale" the
 * way a TTL expiry is - it is scored by a formula this codebase no longer
 * considers correct (see this file's own 0.4/0.6 -> 0.6/0.4 change
 * history). hybrid-search-clauses.ts includes this in its cache key so
 * such a result is never served after a weight change, even if its TTL
 * has not yet elapsed.
 */
export const SEARCH_WEIGHT_VERSION = 2;

/**
 * §Hybrid Search step 3 (Score Merge). A negative cosine score (genuinely
 * dissimilar text) is clamped to 0 here - a clause that is anti-correlated
 * with the query should score the same as "no vector signal at all", not
 * actively subtract from a real keyword match.
 */
export function mergeScores(candidates: HybridSearchCandidate[]): RankedHybridResult[] {
  return candidates.map((candidate) => ({
    ...candidate,
    score: KEYWORD_WEIGHT * candidate.keywordScore + VECTOR_WEIGHT * Math.max(0, candidate.vectorScore),
  }));
}

/**
 * §Hybrid Search step 4 (Rerank) - a real, deterministic (not
 * placeholder) re-scoring pass distinct from the merge sort: clauses
 * whose text contains the user's question as a near-verbatim substring
 * (`exactPhraseMatchIds`) get a fixed bonus before the final sort. This is
 * a legitimate lightweight reranking heuristic (a cross-encoder-style
 * "real" reranker is out of scope without a real LLM/reranker API
 * credential - see docs/operations/ai-platform.md).
 */
export function rerank(
  candidates: RankedHybridResult[],
  exactPhraseMatchIds: ReadonlySet<string>
): RankedHybridResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + (exactPhraseMatchIds.has(candidate.contractClauseId) ? EXACT_PHRASE_BONUS : 0),
    }))
    .sort((a, b) => b.score - a.score);
}
