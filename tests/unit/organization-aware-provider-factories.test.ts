import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAiRolloutConfiguration } from "@/domain/ai/rollout-configuration";

const ALLOWED_POLICY = { aiEnabled: true, allowExternalAiProcessing: true };

/**
 * vi.resetModules() means every module transitively imported by the two
 * factory modules below (including domain/ai/external-ai-policy.ts's
 * error classes) is a FRESH instance - a statically-imported
 * AiDisabledError from before the reset would fail `instanceof` against
 * an error thrown by the freshly-loaded module graph even though it's
 * structurally identical. Importing the error classes dynamically, in the
 * SAME post-reset scope, keeps `instanceof` meaningful.
 */
async function freshFactories() {
  vi.resetModules();
  const embeddingModule = await import("@/server/services/ai/get-embedding-provider-for-organization");
  const llmModule = await import("@/server/services/ai/get-llm-provider-for-organization");
  const policyModule = await import("@/domain/ai/external-ai-policy");
  return {
    getEmbeddingProviderForOrganization: embeddingModule.getEmbeddingProviderForOrganization,
    getLlmProviderForOrganization: llmModule.getLlmProviderForOrganization,
    AiDisabledError: policyModule.AiDisabledError,
    ExternalAiProcessingDisabledError: policyModule.ExternalAiProcessingDisabledError,
  };
}

/**
 * §Phase 13.1 §10/§11 - integration-level tests against the REAL factory
 * functions (not just the pure selectProviderGroup()), confirming a
 * canary-routed organization actually receives a DIFFERENT PROVIDER
 * INSTANCE (openai) than a primary-routed one (development) - never a
 * mock. No real network call happens here (provider CONSTRUCTION only -
 * generateEmbedding()/generateCompletion() are never invoked), so a fake
 * API key value is sufficient and safe.
 */
describe("getEmbeddingProviderForOrganization / getLlmProviderForOrganization (Phase 13.1 §10/§11)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with canary disabled, every organization gets the primary (development) provider", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_LLM_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "false");
    const { getEmbeddingProviderForOrganization, getLlmProviderForOrganization } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    const embedding = getEmbeddingProviderForOrganization({ organizationId: "org-1", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout });
    const llm = getLlmProviderForOrganization({ organizationId: "org-1", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout });

    expect(embedding.group).toBe("primary");
    expect(embedding.provider.providerName).toBe("development");
    expect(llm.group).toBe("primary");
    expect(llm.provider.providerName).toBe("development");
  });

  it("at 100% canary with a configured canary provider, an organization gets the canary (openai) provider instance - a genuinely different provider than primary", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_LLM_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "true");
    vi.stubEnv("AI_CANARY_PERCENTAGE", "100");
    vi.stubEnv("AI_CANARY_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_EMBEDDING_API_KEY", "sk-test-fake-key-never-used-for-a-real-call");
    vi.stubEnv("AI_CANARY_EMBEDDING_MODEL", "text-embedding-3-small");
    vi.stubEnv("AI_CANARY_EMBEDDING_DIMENSION", "256");
    vi.stubEnv("AI_CANARY_LLM_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_LLM_API_KEY", "sk-test-fake-key-never-used-for-a-real-call");
    vi.stubEnv("AI_CANARY_LLM_MODEL", "gpt-4.1-mini");
    const { getEmbeddingProviderForOrganization, getLlmProviderForOrganization } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    const embedding = getEmbeddingProviderForOrganization({ organizationId: "org-1", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout });
    const llm = getLlmProviderForOrganization({ organizationId: "org-1", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout });

    expect(embedding.group).toBe("canary");
    expect(embedding.provider.providerName).toBe("openai");
    expect(llm.group).toBe("canary");
    expect(llm.provider.providerName).toBe("openai");
  });

  it("at 0% canary, an organization always gets primary even with a canary provider configured", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "true");
    vi.stubEnv("AI_CANARY_PERCENTAGE", "0");
    vi.stubEnv("AI_CANARY_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_EMBEDDING_API_KEY", "sk-test-fake-key");
    const { getEmbeddingProviderForOrganization } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    const embedding = getEmbeddingProviderForOrganization({ organizationId: "org-1", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout });
    expect(embedding.group).toBe("primary");
    expect(embedding.provider.providerName).toBe("development");
  });

  it("a policy-disabled organization (aiEnabled=false) never gets ANY provider - primary or canary - zero external calls possible", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "true");
    vi.stubEnv("AI_CANARY_PERCENTAGE", "100");
    vi.stubEnv("AI_CANARY_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_EMBEDDING_API_KEY", "sk-test-fake-key");
    const { getEmbeddingProviderForOrganization, AiDisabledError } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    expect(() =>
      getEmbeddingProviderForOrganization({
        organizationId: "org-1",
        aiPolicy: { aiEnabled: false, allowExternalAiProcessing: true },
        rolloutConfiguration: rollout,
      })
    ).toThrow(AiDisabledError);
  });

  it("an organization with allowExternalAiProcessing=false is refused a REAL (canary or primary-openai) provider", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "true");
    vi.stubEnv("AI_CANARY_PERCENTAGE", "100");
    vi.stubEnv("AI_CANARY_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_EMBEDDING_API_KEY", "sk-test-fake-key");
    const { getEmbeddingProviderForOrganization, ExternalAiProcessingDisabledError } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    expect(() =>
      getEmbeddingProviderForOrganization({
        organizationId: "org-1",
        aiPolicy: { aiEnabled: true, allowExternalAiProcessing: false },
        rolloutConfiguration: rollout,
      })
    ).toThrow(ExternalAiProcessingDisabledError);
  });

  it("an org with allowExternalAiProcessing=false but canary disabled (development stays primary) is still allowed - development never leaves the process", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "false");
    const { getEmbeddingProviderForOrganization } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    const embedding = getEmbeddingProviderForOrganization({
      organizationId: "org-1",
      aiPolicy: { aiEnabled: true, allowExternalAiProcessing: false },
      rolloutConfiguration: rollout,
    });
    expect(embedding.provider.providerName).toBe("development");
  });

  it("the same organization always gets the same group across repeated resolutions within one process (stability)", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "development");
    vi.stubEnv("AI_CANARY_ENABLED", "true");
    vi.stubEnv("AI_CANARY_PERCENTAGE", "50");
    vi.stubEnv("AI_CANARY_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_CANARY_EMBEDDING_API_KEY", "sk-test-fake-key");
    const { getEmbeddingProviderForOrganization } = await freshFactories();
    const rollout = loadAiRolloutConfiguration();

    const results = Array.from({ length: 10 }, () =>
      getEmbeddingProviderForOrganization({ organizationId: "org-repeatable", aiPolicy: ALLOWED_POLICY, rolloutConfiguration: rollout }).group
    );
    expect(new Set(results).size).toBe(1);
  });
});
