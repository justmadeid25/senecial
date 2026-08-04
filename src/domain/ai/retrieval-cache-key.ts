import { hashCacheInput } from "./cache-key";
import { SEARCH_WEIGHT_VERSION } from "./hybrid-search-scoring";

export interface RetrievalCacheKeyParams {
  vectorSearchProviderName: string;
  embeddingProviderName: string;
  embeddingModelName: string;
  embeddingDimension: number;
  organizationId: string;
  question: string;
  topK: number;
}

/**
 * §Phase 12.1 Part 15 (Cache) - every fragment that changes what a cached
 * retrieval result MEANS is in this key: which vector search provider ran
 * it (`pgvector` vs `application` - their score scales/eligibility rules
 * are equivalent but not byte-identical, see clause-vector-search-provider
 * tests), the embedding provider/model/dimension that produced the query
 * vector, and the hybrid scoring weight version (hybrid-search-scoring.ts)
 * - so a re-tuned weight or a switched provider can never serve a
 * result computed under the old configuration, even within the same TTL
 * window. The organization's embedding-SET fingerprint is deliberately
 * NOT part of the key text - see hybrid-search-clauses.ts's own comment
 * on why that is checked against the cached VALUE at read time instead.
 */
export function buildRetrievalCacheKey(params: RetrievalCacheKeyParams): string {
  return (
    `retrieval:${params.vectorSearchProviderName}:${params.embeddingProviderName}:` +
    `${params.embeddingModelName}:${params.embeddingDimension}:w${SEARCH_WEIGHT_VERSION}:` +
    `${params.organizationId}:${hashCacheInput(params.question, String(params.topK))}`
  );
}
