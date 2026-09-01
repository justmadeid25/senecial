import { hashCacheInput } from "./cache-key";
import { CITATION_VALIDATOR_VERSION } from "./citation-required";
import { SEARCH_WEIGHT_VERSION } from "./hybrid-search-scoring";
import { PROMPT_TEMPLATE_VERSION } from "./prompt-builder";

export interface RetrievalCacheKeyParams {
  vectorSearchProviderName: string;
  embeddingProviderName: string;
  embeddingModelName: string;
  embeddingDimension: number;
  organizationId: string;
  question: string;
  topK: number;
  /** §AI 상담 개편 - when set, this cache entry is scoped to one contract; must be part of the key so a contract-scoped result never serves an org-wide (or a different contract's) request. */
  contractId?: string;
}

/**
 * §Phase 12.1 Part 15 (Cache), extended §Phase 12.2 Part F (§34) - every
 * fragment that changes what a cached retrieval result MEANS is in this
 * key: which vector search provider ran it (`pgvector` vs `application` -
 * their score scales/eligibility rules are equivalent but not
 * byte-identical, see clause-vector-search-provider tests), the embedding
 * provider/model/dimension that produced the query vector, and the hybrid
 * scoring weight version (hybrid-search-scoring.ts) - so a re-tuned weight
 * or a switched provider can never serve a result computed under the old
 * configuration, even within the same TTL window. `promptTemplateVersion`/
 * `citationValidatorVersion` are ALSO included per §34's explicit
 * requirement, even though raw retrieval results (clause ids/scores) don't
 * semantically depend on either - the cost is a slightly lower hit rate
 * when only a downstream prompt/citation version bumps; the benefit is
 * that no AI-quality-relevant setting is ever excluded from ANY cache key
 * by omission. The organization's embedding-SET fingerprint is
 * deliberately NOT part of the key text - see hybrid-search-clauses.ts's
 * own comment on why that is checked against the cached VALUE at read
 * time instead.
 */
export function buildRetrievalCacheKey(params: RetrievalCacheKeyParams): string {
  return (
    `retrieval:${params.vectorSearchProviderName}:${params.embeddingProviderName}:` +
    `${params.embeddingModelName}:${params.embeddingDimension}:w${SEARCH_WEIGHT_VERSION}:` +
    `p${PROMPT_TEMPLATE_VERSION}:c${CITATION_VALIDATOR_VERSION}:` +
    `${params.organizationId}:${hashCacheInput(params.question, String(params.topK), params.contractId ?? "")}`
  );
}
