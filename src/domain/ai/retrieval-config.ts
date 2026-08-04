/**
 * §Phase 12.2 Part C - lives here (not inline in hybrid-search-clauses.ts)
 * so it can be imported by both the retrieval pipeline (features/ai/server)
 * and the AiRuntimeConfiguration builder (server/services/ai) without the
 * latter having to depend on the former - features/ already depends on
 * server/services/ai (getEmbeddingProvider, getClauseVectorSearchProvider,
 * getCacheProvider), so the reverse dependency would be circular.
 */
export const DEFAULT_TOP_K = 10;
