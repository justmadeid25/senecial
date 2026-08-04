import { describe, expect, it } from "vitest";

import { InMemoryConcurrencyLimiter } from "@/server/services/ai/concurrency/in-memory-concurrency-limiter";

describe("InMemoryConcurrencyLimiter (Phase 12.2 §33)", () => {
  it("acquires up to the max, then rejects further acquisitions for the same key", async () => {
    const limiter = new InMemoryConcurrencyLimiter();
    const first = await limiter.acquire("user-1", 2);
    const second = await limiter.acquire("user-1", 2);
    const third = await limiter.acquire("user-1", 2);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);
    expect(third.acquired).toBe(false);
    expect(third.currentCount).toBe(2);
  });

  it("tracks different keys independently", async () => {
    const limiter = new InMemoryConcurrencyLimiter();
    await limiter.acquire("user-1", 1);
    const userTwo = await limiter.acquire("user-2", 1);
    expect(userTwo.acquired).toBe(true);
  });

  it("release frees a slot for a subsequent acquire", async () => {
    const limiter = new InMemoryConcurrencyLimiter();
    await limiter.acquire("user-1", 1);
    const blocked = await limiter.acquire("user-1", 1);
    expect(blocked.acquired).toBe(false);

    await limiter.release("user-1");
    const afterRelease = await limiter.acquire("user-1", 1);
    expect(afterRelease.acquired).toBe(true);
  });

  it("release on an already-empty key is a safe no-op (never goes negative)", async () => {
    const limiter = new InMemoryConcurrencyLimiter();
    await expect(limiter.release("never-acquired")).resolves.toBeUndefined();
    const result = await limiter.acquire("never-acquired", 1);
    expect(result.acquired).toBe(true);
  });
});
