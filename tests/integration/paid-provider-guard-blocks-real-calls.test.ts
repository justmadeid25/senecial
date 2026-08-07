import { afterEach, describe, expect, it, vi } from "vitest";

import { PaidProviderCallBlockedError } from "@/domain/ai/paid-provider-guard";
import { getEmbeddingProvider, resetEmbeddingProviderCacheForTests } from "@/server/services/ai/get-embedding-provider";
import { getLlmProvider, resetLlmProviderCacheForTests } from "@/server/services/ai/get-llm-provider";

/**
 * §Phase 13.2 - proves the actual incident's failure mode is now
 * structurally impossible: even with a real-shaped OPENAI_API_KEY and
 * AI_LLM_PROVIDER=openai/AI_EMBEDDING_PROVIDER=openai present in the
 * environment (exactly the local .env state that caused the incident),
 * NODE_ENV=test (vitest's own default, never overridden here) blocks the
 * call before any network I/O - a global fetch spy proves zero HTTP
 * requests were ever dispatched, not merely that a Promise rejected.
 */
describe("paid-provider guard blocks real calls even with real-shaped credentials present (Phase 13.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetLlmProviderCacheForTests();
    resetEmbeddingProviderCacheForTests();
  });

  it("pnpm ai:evaluate / pnpm test style invocation: real OpenAI LLM provider never dispatches a fetch call", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-fake-key-shaped-like-a-real-one-0000000000000000");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    resetLlmProviderCacheForTests();

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const provider = getLlmProvider();
    expect(provider.providerName).toBe("openai");

    await expect(
      provider.generateCompletion([{ role: "user", content: "이것은 테스트 메시지입니다." }])
    ).rejects.toThrow(PaidProviderCallBlockedError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("real OpenAI embedding provider never dispatches a fetch call under the same conditions", async () => {
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-fake-key-shaped-like-a-real-one-0000000000000000");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    resetEmbeddingProviderCacheForTests();

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const provider = getEmbeddingProvider();
    expect(provider.providerName).toBe("openai");

    await expect(provider.generateEmbedding("테스트 조항 텍스트")).rejects.toThrow(PaidProviderCallBlockedError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streaming also never dispatches a fetch call", async () => {
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-fake-key-shaped-like-a-real-one-0000000000000000");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    resetLlmProviderCacheForTests();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = getLlmProvider();

    async function drain() {
      for await (const _event of provider.stream([{ role: "user", content: "테스트" }])) {
        // never expected to yield anything - the guard throws before any fetch.
      }
    }

    await expect(drain()).rejects.toThrow(PaidProviderCallBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
