import { afterEach, describe, expect, it, vi } from "vitest";

import { PaidProviderCallBlockedError } from "@/domain/ai/paid-provider-guard";
import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";
import { executeWithResilience } from "@/server/services/ai/providers/execute-with-resilience";

/**
 * §Phase 13.2 - executeWithResilience() is the single call site every real
 * provider (embedding or LLM) routes its network attempt through, so this
 * is where the NODE_ENV=test hard guard must actually live to be a true
 * "last line of defense" - these tests prove the block happens BEFORE any
 * side effect (circuit breaker state, retry, the attempt callback itself),
 * never merely as a caller-side convention that could be bypassed.
 */
describe("executeWithResilience - paid-call guard wiring (Phase 13.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks under NODE_ENV=test without ever invoking the attempt callback or the circuit breaker", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    const circuitBreaker = new InMemoryCircuitBreaker();
    const beforeCallSpy = vi.spyOn(circuitBreaker, "beforeCall");
    const attempt = vi.fn(async () => "should-never-run");

    await expect(
      executeWithResilience({
        providerName: "openai",
        operation: "llm",
        circuitBreaker,
        timeoutMs: 1000,
        attempt,
      })
    ).rejects.toThrow(PaidProviderCallBlockedError);

    expect(attempt).not.toHaveBeenCalled();
    expect(beforeCallSpy).not.toHaveBeenCalled();
  });

  it("a blocked call is never counted as a circuit breaker failure", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    const circuitBreaker = new InMemoryCircuitBreaker();
    const onFailureSpy = vi.spyOn(circuitBreaker, "onFailure");
    const attempt = vi.fn(async () => "unused");

    await expect(
      executeWithResilience({ providerName: "openai", operation: "embedding", circuitBreaker, timeoutMs: 1000, attempt })
    ).rejects.toThrow(PaidProviderCallBlockedError);

    expect(onFailureSpy).not.toHaveBeenCalled();
    expect(await circuitBreaker.getState("openai")).toBe("CLOSED");
  });

  it("allows the real attempt through when TEST_REAL_AI_PROVIDER=true (the opt-in real-provider suite's own escape hatch)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", "true");
    const circuitBreaker = new InMemoryCircuitBreaker();
    const attempt = vi.fn(async () => "real-result");

    const result = await executeWithResilience({
      providerName: "openai",
      operation: "llm",
      circuitBreaker,
      timeoutMs: 1000,
      attempt,
    });

    expect(result).toBe("real-result");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("allows the real attempt through in production regardless of TEST_REAL_AI_PROVIDER", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    const circuitBreaker = new InMemoryCircuitBreaker();
    const attempt = vi.fn(async () => "prod-result");

    const result = await executeWithResilience({
      providerName: "openai",
      operation: "llm",
      circuitBreaker,
      timeoutMs: 1000,
      attempt,
    });

    expect(result).toBe("prod-result");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
