import { hashCacheInput } from "./cache-key";
import { CITATION_VALIDATOR_VERSION } from "./citation-required";
import { SEARCH_WEIGHT_VERSION } from "./hybrid-search-scoring";
import { LEGAL_CONCEPT_EXPANSION_VERSION } from "./legal-concept-expansion";
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
  /** §AI 답변 품질 개편 P0-1 - deterministic fingerprint of the bounded conversation history folded into THIS request's retrieval query (see conversation-context.ts's buildHistoryFingerprint()). Must be part of the key so two conversations with an identical final question but different prior turns never share a cached result computed under a different effective search query. */
  historyFingerprint?: string;
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
 *
 * §AI 답변 품질 개편 Phase 1.2 - `LEGAL_CONCEPT_EXPANSION_VERSION` closes a
 * real gap: legal-concept-expansion.ts's own docstring already claimed a
 * vocabulary re-tune was "included in the retrieval cache key indirectly",
 * but that was never actually true until now - the keyword SET a re-tuned
 * expansion table produces changes, but the cache KEY itself was keyed
 * only on the raw question text, so a cache entry computed under a
 * pre-deploy vocabulary could still be served, unchanged, for the rest of
 * its (short, 5-minute) TTL. Same explicit-inclusion policy as
 * `searchWeightVersion`/`promptTemplateVersion` above - never rely on
 * question-text hashing to happen to differ.
 */
export function buildRetrievalCacheKey(params: RetrievalCacheKeyParams): string {
  return (
    `retrieval:${params.vectorSearchProviderName}:${params.embeddingProviderName}:` +
    `${params.embeddingModelName}:${params.embeddingDimension}:w${SEARCH_WEIGHT_VERSION}:` +
    `p${PROMPT_TEMPLATE_VERSION}:c${CITATION_VALIDATOR_VERSION}:e${LEGAL_CONCEPT_EXPANSION_VERSION}:` +
    `${params.organizationId}:${hashCacheInput(params.question, String(params.topK), params.contractId ?? "", params.historyFingerprint ?? "")}`
  );
}
