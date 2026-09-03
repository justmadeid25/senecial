import { describe, expect, it } from "vitest";

import {
  AI_CONFIG_VERSION,
  computeAiConfigChecksum,
  type AiRuntimeConfiguration,
} from "@/domain/ai/ai-runtime-configuration";

function baseConfig(overrides: Partial<AiRuntimeConfiguration> = {}): AiRuntimeConfiguration {
  return {
    version: AI_CONFIG_VERSION,
    embeddingProvider: "development",
    embeddingModel: "hashing-trick-v1",
    embeddingDimension: 256,
    embeddingVersion: "v1",
    vectorSearchProvider: "pgvector",
    hybridKeywordWeight: 0.6,
    hybridVectorWeight: 0.4,
    hybridExactPhraseBonus: 0.1,
    searchWeightVersion: "2",
    rerankerVersion: "exact-phrase-bonus-v1",
    retrievalTopK: 10,
    contextMaxTokens: 128_000,
    contextBudgetVersion: "token-budget-v2",
    hallucinationGuardVersion: "v1",
    hallucinationThreshold: 0.15,
    refusalThreshold: 1,
    citationValidatorVersion: "v1",
    promptTemplateVersion: "v1",
    riskLanguageGuardVersion: "v1",
    ...overrides,
  };
}

describe("computeAiConfigChecksum (Phase 12.2 §21)", () => {
  it("is deterministic for identical config values", () => {
    expect(computeAiConfigChecksum(baseConfig())).toBe(computeAiConfigChecksum(baseConfig()));
  });

  it("is stable regardless of object literal key order", () => {
    const a = baseConfig();
    // Rebuild with keys in a different order - JS preserves insertion order,
    // so this is a real test of the sorted-key canonicalization, not a no-op.
    const b: AiRuntimeConfiguration = {
      riskLanguageGuardVersion: a.riskLanguageGuardVersion,
      promptTemplateVersion: a.promptTemplateVersion,
      citationValidatorVersion: a.citationValidatorVersion,
      refusalThreshold: a.refusalThreshold,
      hallucinationThreshold: a.hallucinationThreshold,
      hallucinationGuardVersion: a.hallucinationGuardVersion,
      contextBudgetVersion: a.contextBudgetVersion,
      contextMaxTokens: a.contextMaxTokens,
      retrievalTopK: a.retrievalTopK,
      rerankerVersion: a.rerankerVersion,
      searchWeightVersion: a.searchWeightVersion,
      hybridExactPhraseBonus: a.hybridExactPhraseBonus,
      hybridVectorWeight: a.hybridVectorWeight,
      hybridKeywordWeight: a.hybridKeywordWeight,
      vectorSearchProvider: a.vectorSearchProvider,
      embeddingVersion: a.embeddingVersion,
      embeddingDimension: a.embeddingDimension,
      embeddingModel: a.embeddingModel,
      embeddingProvider: a.embeddingProvider,
      version: a.version,
    };
    expect(computeAiConfigChecksum(a)).toBe(computeAiConfigChecksum(b));
  });

  it("changes when any single field changes (config version change detection)", () => {
    const original = computeAiConfigChecksum(baseConfig());
    expect(computeAiConfigChecksum(baseConfig({ hybridKeywordWeight: 0.7 }))).not.toBe(original);
    expect(computeAiConfigChecksum(baseConfig({ vectorSearchProvider: "application" }))).not.toBe(original);
    expect(computeAiConfigChecksum(baseConfig({ promptTemplateVersion: "v2" }))).not.toBe(original);
    expect(computeAiConfigChecksum(baseConfig({ hallucinationThreshold: 0.2 }))).not.toBe(original);
  });

  it("produces a short (16 hex char) fingerprint, not a raw JSON dump", () => {
    const checksum = computeAiConfigChecksum(baseConfig());
    expect(checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it("§20 - the type has no field for any secret/credential (compile-time guarantee, asserted here defensively at runtime)", () => {
    const config = baseConfig();
    const serialized = JSON.stringify(config).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "secret", "password", "credential"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // "token" alone is too broad a substring to forbid outright - §Phase
    // 14.1 §5 legitimately added `contextMaxTokens` (an LLM tokenizer
    // sizing unit, the same "tokens" vocabulary as promptTokens/
    // completionTokens elsewhere in this codebase), which is not a
    // credential. The real danger is an AUTH token field specifically.
    for (const forbidden of ["apitoken", "authtoken", "accesstoken", "refreshtoken", "bearertoken", "sessiontoken"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
