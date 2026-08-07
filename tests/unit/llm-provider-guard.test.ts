import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §Phase 13.2 - regression test for a real incident: buildLlmProviderForDriver()
 * used to call getAiCircuitBreaker() UNCONDITIONALLY before branching on
 * driver, so AI_LLM_PROVIDER=development still opened a real Redis
 * connection whenever RATE_LIMITER=redis was set (this codebase reuses that
 * var for the AI circuit breaker too). Nothing ever closed that connection,
 * so a short-lived CLI script (scripts/ai-evaluate.ts, which forces
 * "development" unconditionally) hung indefinitely in CI - an open ioredis
 * connection keeps the Node.js event loop alive. Fixed by returning the
 * development provider BEFORE getAiCircuitBreaker() is ever called.
 */
describe("getLlmProvider - development driver never touches Redis (Phase 13.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/server/services/ai/circuit-breaker/redis-circuit-breaker-client");
    vi.resetModules();
  });

  it("does not construct a Redis circuit-breaker client even when RATE_LIMITER=redis", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_LLM_PROVIDER", "development");
    vi.stubEnv("RATE_LIMITER", "redis");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    vi.resetModules();
    const redisClientSpy = vi.fn();
    vi.doMock("@/server/services/ai/circuit-breaker/redis-circuit-breaker-client", () => ({
      getAiCircuitBreakerRedisClient: redisClientSpy,
    }));

    const { getLlmProvider } = await import("@/server/services/ai/get-llm-provider");
    const provider = getLlmProvider();

    expect(provider.providerName).toBe("development");
    expect(redisClientSpy).not.toHaveBeenCalled();
  });

  it("DOES construct the Redis circuit-breaker client for a real driver under RATE_LIMITER=redis (sanity check the mock itself works)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-fake-key-for-config-construction-only");
    vi.stubEnv("RATE_LIMITER", "redis");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    vi.resetModules();
    const redisClientSpy = vi.fn(() => ({}));
    vi.doMock("@/server/services/ai/circuit-breaker/redis-circuit-breaker-client", () => ({
      getAiCircuitBreakerRedisClient: redisClientSpy,
    }));

    const { getLlmProvider } = await import("@/server/services/ai/get-llm-provider");
    getLlmProvider();

    expect(redisClientSpy).toHaveBeenCalledTimes(1);
  });
});
