/**
 * §Phase 12.2 Part C - lives here (not inline in hybrid-search-clauses.ts)
 * so it can be imported by both the retrieval pipeline (features/ai/server)
 * and the AiRuntimeConfiguration builder (server/services/ai) without the
 * latter having to depend on the former - features/ already depends on
 * server/services/ai (getEmbeddingProvider, getClauseVectorSearchProvider,
 * getCacheProvider), so the reverse dependency would be circular.
 */
export const DEFAULT_TOP_K = 10;

/**
 * §Phase 14.1 §15 - the per-leg topK used for a question classified
 * "comprehensive" (domain/ai/question-complexity.ts) instead of
 * DEFAULT_TOP_K. Casts a much wider retrieval net (more candidates per
 * leg, in turn a larger vector candidate pool - see
 * VECTOR_CANDIDATE_POOL_MULTIPLIER in hybrid-search-clauses.ts/
 * hybrid-search-document-chunks.ts) so risks scattered across many
 * locations in one contract (§12's acceptance test) have a real chance of
 * all being retrieved - the token-budget context builder
 * (context-token-budget.ts), not this constant, is what then decides how
 * many of those wider candidates actually fit in the prompt.
 */
export const COMPREHENSIVE_TOP_K = 30;
