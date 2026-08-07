import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";
import { OpenAiEmbeddingProvider } from "@/server/services/ai/providers/openai-embedding-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeProvider() {
  return new OpenAiEmbeddingProvider("text-embedding-3-small", {
    apiKey: "test-key",
    baseUrl: "https://api.openai.com/v1",
    dimension: 3,
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 20 },
    circuitBreaker: new InMemoryCircuitBreaker(),
  });
}

describe("OpenAiEmbeddingProvider (Phase 13 §7 - batch ordering, NaN/Infinity rejection)", () => {
  // §Phase 13.2 - executeWithResilience() hard-blocks real provider calls
  // under NODE_ENV=test unless TEST_REAL_AI_PROVIDER=true (see
  // src/domain/ai/paid-provider-guard.ts). This suite replaces
  // global.fetch with vi.stubGlobal below, so no real network call is
  // EVER possible here regardless of this flag - it exists only to get
  // past the guard so these tests can exercise the provider's real
  // request-building/response-parsing logic against a safe mock.
  beforeEach(() => {
    vi.stubEnv("TEST_REAL_AI_PROVIDER", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("generateEmbedding returns a validated vector matching the configured dimension", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }], usage: { prompt_tokens: 5 } }))
    );
    const provider = makeProvider();
    const result = await provider.generateEmbedding("테스트 문장");
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimension).toBe(3);
    expect(result.usage?.inputTokens).toBe(5);
  });

  it("rejects a response vector whose length does not match the configured dimension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ embedding: [0.1, 0.2], index: 0 }] })));
    const provider = makeProvider();
    await expect(provider.generateEmbedding("텍스트")).rejects.toThrow();
  });

  it("rejects a response vector containing NaN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ embedding: [0.1, Number.NaN, 0.3], index: 0 }] })));
    const provider = makeProvider();
    await expect(provider.generateEmbedding("텍스트")).rejects.toThrow();
  });

  it("rejects a response vector containing Infinity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ embedding: [0.1, Number.POSITIVE_INFINITY, 0.3], index: 0 }] })));
    const provider = makeProvider();
    await expect(provider.generateEmbedding("텍스트")).rejects.toThrow();
  });

  it("generateEmbeddings maps results by each item's own `index`, never assuming request order is preserved", async () => {
    // Deliberately out-of-order response - item for input[1] arrives first.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            { embedding: [1, 0, 0], index: 1 },
            { embedding: [0, 1, 0], index: 0 },
          ],
          usage: { prompt_tokens: 10 },
        })
      )
    );
    const provider = makeProvider();
    const result = await provider.generateEmbeddings(["첫번째", "두번째"]);
    const byIndex = new Map(result.results.map((r) => [r.index, r.vector]));
    expect(byIndex.get(0)).toEqual([0, 1, 0]);
    expect(byIndex.get(1)).toEqual([1, 0, 0]);
  });

  it("rejects a batch call whose response item count does not match the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ embedding: [1, 0, 0], index: 0 }] })));
    const provider = makeProvider();
    await expect(provider.generateEmbeddings(["첫번째", "두번째"])).rejects.toThrow();
  });

  it("normalizes an HTTP error status into a ProviderError, never a raw fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const provider = makeProvider();
    await expect(provider.generateEmbedding("텍스트")).rejects.toMatchObject({ errorCode: "PROVIDER_AUTH_FAILED" });
  });
});
