import { describe, expect, it } from "vitest";

import { CIRCUIT_BREAKER_CONFIG } from "@/domain/ai/circuit-breaker";
import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";

const FAST_CONFIG = { failureThreshold: 3, failureWindowSeconds: 60, openDurationSeconds: 0.05, probeTimeoutMs: 50 };

describe("InMemoryCircuitBreaker (Phase 13 §17 - state transitions)", () => {
  it("starts CLOSED and allows calls", async () => {
    const breaker = new InMemoryCircuitBreaker();
    const token = await breaker.beforeCall("openai");
    expect(token.allowed).toBe(true);
    expect(token.state).toBe("CLOSED");
  });

  it("opens after reaching the failure threshold", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    await breaker.onFailure("openai");
    await breaker.onFailure("openai");
    expect((await breaker.beforeCall("openai")).state).toBe("CLOSED");
    await breaker.onFailure("openai");
    expect(await breaker.getState("openai")).toBe("OPEN");
  });

  it("blocks calls while OPEN", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) await breaker.onFailure("openai");
    const token = await breaker.beforeCall("openai");
    expect(token.allowed).toBe(false);
    expect(token.state).toBe("OPEN");
  });

  it("transitions to HALF_OPEN after the open duration elapses, allowing exactly one probe", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) await breaker.onFailure("openai");

    await new Promise((resolve) => setTimeout(resolve, FAST_CONFIG.openDurationSeconds * 1000 + 10));

    const probe1 = await breaker.beforeCall("openai");
    expect(probe1.allowed).toBe(true);
    expect(probe1.state).toBe("HALF_OPEN");

    const probe2 = await breaker.beforeCall("openai");
    expect(probe2.allowed).toBe(false);
    expect(probe2.state).toBe("HALF_OPEN");
  });

  it("a successful HALF_OPEN probe closes the circuit", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) await breaker.onFailure("openai");
    await new Promise((resolve) => setTimeout(resolve, FAST_CONFIG.openDurationSeconds * 1000 + 10));

    await breaker.beforeCall("openai"); // consumes the probe slot
    await breaker.onSuccess("openai");

    expect(await breaker.getState("openai")).toBe("CLOSED");
    expect((await breaker.beforeCall("openai")).allowed).toBe(true);
  });

  it("a failed HALF_OPEN probe immediately re-opens (does not wait for the failure threshold again)", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) await breaker.onFailure("openai");
    await new Promise((resolve) => setTimeout(resolve, FAST_CONFIG.openDurationSeconds * 1000 + 10));

    await breaker.beforeCall("openai"); // consumes the probe slot
    await breaker.onFailure("openai"); // the probe itself failed

    expect(await breaker.getState("openai")).toBe("OPEN");
  });

  it("tracks different provider keys independently", async () => {
    const breaker = new InMemoryCircuitBreaker(FAST_CONFIG);
    for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) await breaker.onFailure("openai");
    expect(await breaker.getState("openai")).toBe("OPEN");
    expect(await breaker.getState("anthropic")).toBe("CLOSED");
  });

  it("a success while CLOSED is a harmless reset (never throws, stays CLOSED)", async () => {
    const breaker = new InMemoryCircuitBreaker(CIRCUIT_BREAKER_CONFIG);
    await breaker.onFailure("openai");
    await breaker.onSuccess("openai");
    expect(await breaker.getState("openai")).toBe("CLOSED");
  });
});
