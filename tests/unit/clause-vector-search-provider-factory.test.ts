import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFactory() {
  vi.resetModules();
  const factoryModule = await import("@/server/services/ai/vector-search/get-clause-vector-search-provider");
  return factoryModule.getClauseVectorSearchProvider;
}

describe("getClauseVectorSearchProvider (Phase 12.1 §8/§20 - config parsing)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to pgvector when AI_VECTOR_SEARCH_PROVIDER is unset (reversed polarity from the other AI provider factories)", async () => {
    const getClauseVectorSearchProvider = await loadFactory();
    expect(getClauseVectorSearchProvider().providerName).toBe("pgvector");
  });

  it("returns the application provider when explicitly configured", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_PROVIDER", "application");
    const getClauseVectorSearchProvider = await loadFactory();
    expect(getClauseVectorSearchProvider().providerName).toBe("application");
  });

  it("returns the pgvector provider when explicitly configured", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_PROVIDER", "pgvector");
    const getClauseVectorSearchProvider = await loadFactory();
    expect(getClauseVectorSearchProvider().providerName).toBe("pgvector");
  });

  it("throws for an unrecognized provider value", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_PROVIDER", "some-unimplemented-provider");
    const getClauseVectorSearchProvider = await loadFactory();
    expect(() => getClauseVectorSearchProvider()).toThrow(/지원하지 않는 AI_VECTOR_SEARCH_PROVIDER/);
  });

  it("caches the resolved provider across calls within the same module instance", async () => {
    const getClauseVectorSearchProvider = await loadFactory();
    expect(getClauseVectorSearchProvider()).toBe(getClauseVectorSearchProvider());
  });
});
