import { createHash } from "node:crypto";

/**
 * §Phase 12.2 Part C (§20) - bump ONLY on a structural change to
 * `AiRuntimeConfiguration` itself (a field added/removed/renamed) - never
 * for a threshold/weight retune, which is already independently tracked by
 * each field's own `*Version` value below. This distinguishes "the shape
 * of what we version" from "the values being versioned."
 */
export const AI_CONFIG_VERSION = "14.1.0";

/**
 * §20 - the single, versioned object every AI-quality-relevant setting
 * flows through: cache keys (§34), evaluation reports (§26), `/api/metrics`
 * labels are NOT included here (see checksum's own docstring on
 * cardinality), and conversation/message provenance (§22). Deliberately
 * has NO field for any credential/endpoint/secret - see
 * get-ai-runtime-configuration.ts (server/services/ai), which assembles a
 * live instance of this type from provider objects that themselves never
 * expose their API keys through `providerName`/`modelName`.
 */
export interface AiRuntimeConfiguration {
  version: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingVersion: string;
  vectorSearchProvider: string;
  hybridKeywordWeight: number;
  hybridVectorWeight: number;
  hybridExactPhraseBonus: number;
  searchWeightVersion: string;
  rerankerVersion: string;
  retrievalTopK: number;
  /** §Phase 14.1 §5 - replaces the old fixed contextMaxClauses count. The real token budget evidence packing must fit under (context-token-budget.ts). */
  contextMaxTokens: number;
  contextBudgetVersion: string;
  hallucinationGuardVersion: string;
  hallucinationThreshold: number;
  refusalThreshold: number;
  citationValidatorVersion: string;
  promptTemplateVersion: string;
  riskLanguageGuardVersion: string;
}

/**
 * §21 - deterministic, order-independent checksum over every field of
 * `config`. Keys are sorted before hashing (via JSON.stringify's replacer
 * array form) so the checksum is stable regardless of how the object
 * literal was written - two configs with identical VALUES always produce
 * the identical checksum, never a false mismatch from key ordering alone.
 * Truncated to 16 hex chars (64 bits) - collision risk is irrelevant here
 * (this is a change-detection fingerprint for cache/provenance/gate
 * comparison, not a security boundary), and a short checksum is what
 * actually gets logged/stored/compared throughout the rest of this phase.
 */
export function computeAiConfigChecksum(config: AiRuntimeConfiguration): string {
  const sortedKeys = Object.keys(config).sort() as (keyof AiRuntimeConfiguration)[];
  const canonical = JSON.stringify(config, sortedKeys);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}
