import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFactory() {
  vi.resetModules();
  const factoryModule = await import("@/server/services/ai/get-embedding-provider");
  return factoryModule.getEmbeddingProvider;
}

describe("getEmbeddingProvider - production guard (Phase 12 Part A)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the deterministic development provider outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getEmbeddingProvider = await loadFactory();
    expect(() => getEmbeddingProvider()).not.toThrow();
  });

  it("throws in production when the development provider is used without an explicit override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getEmbeddingProvider = await loadFactory();
    expect(() => getEmbeddingProvider()).toThrow(/AI_EMBEDDING_PROVIDER=development/);
  });

  it("allows the development provider in production only with the explicit override set to true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEVELOPMENT_AI_PROVIDER", "true");
    const getEmbeddingProvider = await loadFactory();
    expect(() => getEmbeddingProvider()).not.toThrow();
  });

  it("throws for an unrecognized provider driver value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "some-unimplemented-provider");
    const getEmbeddingProvider = await loadFactory();
    expect(() => getEmbeddingProvider()).toThrow(/지원하지 않는 AI_EMBEDDING_PROVIDER/);
  });

  it("the returned provider's dimension matches what it actually produces", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getEmbeddingProvider = await loadFactory();
    const provider = getEmbeddingProvider();
    const result = await provider.generateEmbedding("테스트 조항");
    expect(result.vector).toHaveLength(provider.dimension);
    expect(result.dimension).toBe(provider.dimension);
  });
});
