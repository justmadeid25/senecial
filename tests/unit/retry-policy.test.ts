import { describe, expect, it } from "vitest";

import { computeBackoffMs, DEFAULT_RETRY_POLICY } from "@/domain/ai/retry-policy";

describe("computeBackoffMs (Phase 13 §16 - backoff+jitter)", () => {
  it("attempt 0 is in [250ms, 500ms] (base 500ms * [0.5, 1.0] jitter)", () => {
    expect(computeBackoffMs(0, DEFAULT_RETRY_POLICY, () => 0)).toBe(250);
    expect(computeBackoffMs(0, DEFAULT_RETRY_POLICY, () => 1)).toBe(500);
  });

  it("attempt 1 is in [750ms, 1500ms] (base 500ms * 3^1)", () => {
    expect(computeBackoffMs(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(750);
    expect(computeBackoffMs(1, DEFAULT_RETRY_POLICY, () => 1)).toBe(1500);
  });

  it("is capped at maxDelayMs even for a large attempt index (500ms * 3^2 = 4500 -> capped to 4000)", () => {
    expect(computeBackoffMs(2, DEFAULT_RETRY_POLICY, () => 1)).toBe(4000);
    expect(computeBackoffMs(10, DEFAULT_RETRY_POLICY, () => 1)).toBe(4000);
  });

  it("never returns a negative or zero delay for randomFn=0 at attempt 0 (jitter floor is 0.5x, never 0x)", () => {
    expect(computeBackoffMs(0, DEFAULT_RETRY_POLICY, () => 0)).toBeGreaterThan(0);
  });

  it("is deterministic for a fixed randomFn (no reliance on real Math.random in this test)", () => {
    const fixedRandom = () => 0.5;
    const first = computeBackoffMs(1, DEFAULT_RETRY_POLICY, fixedRandom);
    const second = computeBackoffMs(1, DEFAULT_RETRY_POLICY, fixedRandom);
    expect(first).toBe(second);
  });
});
