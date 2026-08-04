import {
  AI_CONFIG_VERSION,
  type AiRuntimeConfiguration,
  computeAiConfigChecksum,
} from "@/domain/ai/ai-runtime-configuration";
import { RISK_LANGUAGE_GUARD_VERSION } from "@/domain/ai/ai-review-guard";
import { CITATION_VALIDATOR_VERSION } from "@/domain/ai/citation-required";
import { CONTEXT_MAX_CLAUSES } from "@/domain/ai/context-budget";
import { HALLUCINATION_GUARD_VERSION, MIN_CITATION_COUNT, MIN_CITATION_SCORE } from "@/domain/ai/hallucination-guard";
import {
  EXACT_PHRASE_BONUS,
  KEYWORD_WEIGHT,
  RERANKER_VERSION,
  SEARCH_WEIGHT_VERSION,
  VECTOR_WEIGHT,
} from "@/domain/ai/hybrid-search-scoring";
import { PROMPT_TEMPLATE_VERSION } from "@/domain/ai/prompt-builder";
import { DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";
import { EMBEDDING_PIPELINE_VERSION } from "@/domain/ai/vector-search-config";

import { getEmbeddingProvider } from "./get-embedding-provider";
import { getClauseVectorSearchProvider } from "./vector-search/get-clause-vector-search-provider";

export interface AiRuntimeConfigurationWithChecksum extends AiRuntimeConfiguration {
  checksum: string;
}

/**
 * §Phase 12.2 Part C (§20/§21) - the single call site every consumer
 * (cache keys, provenance, release manifest, evaluation report, startup
 * log) should use instead of re-reading individual env vars/constants
 * itself. Lives in server/services/ai (not domain/ai) because it resolves
 * LIVE provider objects (getEmbeddingProvider() can throw in production
 * without an explicit override - see that function's own docstring) -
 * domain/ai modules stay pure/provider-agnostic by convention (see e.g.
 * hybrid-search-scoring.ts's own docstring on why it never touches a
 * provider or the DB directly).
 */
export function getAiRuntimeConfiguration(): AiRuntimeConfigurationWithChecksum {
  const embeddingProvider = getEmbeddingProvider();
  const vectorSearchProvider = getClauseVectorSearchProvider();

  const config: AiRuntimeConfiguration = {
    version: AI_CONFIG_VERSION,
    embeddingProvider: embeddingProvider.providerName,
    embeddingModel: embeddingProvider.modelName,
    embeddingDimension: embeddingProvider.dimension,
    embeddingVersion: EMBEDDING_PIPELINE_VERSION,
    vectorSearchProvider: vectorSearchProvider.providerName,
    hybridKeywordWeight: KEYWORD_WEIGHT,
    hybridVectorWeight: VECTOR_WEIGHT,
    hybridExactPhraseBonus: EXACT_PHRASE_BONUS,
    searchWeightVersion: String(SEARCH_WEIGHT_VERSION),
    rerankerVersion: RERANKER_VERSION,
    retrievalTopK: DEFAULT_TOP_K,
    contextMaxClauses: CONTEXT_MAX_CLAUSES,
    hallucinationGuardVersion: HALLUCINATION_GUARD_VERSION,
    hallucinationThreshold: MIN_CITATION_SCORE,
    refusalThreshold: MIN_CITATION_COUNT,
    citationValidatorVersion: CITATION_VALIDATOR_VERSION,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    riskLanguageGuardVersion: RISK_LANGUAGE_GUARD_VERSION,
  };

  return { ...config, checksum: computeAiConfigChecksum(config) };
}
