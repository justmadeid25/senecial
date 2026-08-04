import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFactory() {
  vi.resetModules();
  const factoryModule = await import("@/server/services/ai/cache/get-cache-provider");
  return factoryModule.getCacheProvider;
}

describe("getCacheProvider - production guard (Phase 12 Part N §Cache)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the in-memory cache provider outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getCacheProvider = await loadFactory();
    expect(() => getCacheProvider()).not.toThrow();
  });

  it("throws in production when the in-memory cache is used without an explicit override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getCacheProvider = await loadFactory();
    expect(() => getCacheProvider()).toThrow(/AI_CACHE_PROVIDER=memory/);
  });

  it("allows the in-memory cache in production only with the explicit override set to true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_IN_MEMORY_AI_CACHE", "true");
    const getCacheProvider = await loadFactory();
    expect(() => getCacheProvider()).not.toThrow();
  });

  it("throws for an unrecognized cache driver value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_CACHE_PROVIDER", "some-unimplemented-cache");
    const getCacheProvider = await loadFactory();
    expect(() => getCacheProvider()).toThrow(/지원하지 않는 AI_CACHE_PROVIDER/);
  });

  it("the returned provider actually stores and retrieves a value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getCacheProvider = await loadFactory();
    const cache = getCacheProvider();
    await cache.set("key", "value", 60);
    await expect(cache.get("key")).resolves.toBe("value");
  });
});
