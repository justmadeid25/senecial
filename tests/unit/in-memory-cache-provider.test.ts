import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCacheProvider } from "@/server/services/ai/cache/in-memory-cache-provider";

describe("InMemoryCacheProvider (Phase 12 Part N §Cache)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for a key that was never set", async () => {
    const cache = new InMemoryCacheProvider();
    await expect(cache.get("missing")).resolves.toBeUndefined();
  });

  it("returns the stored value before the TTL elapses", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("k", "v", 60);
    await expect(cache.get("k")).resolves.toBe("v");
  });

  it("returns undefined once the TTL has elapsed", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("k", "v", 10);

    vi.advanceTimersByTime(9_000);
    await expect(cache.get("k")).resolves.toBe("v");

    vi.advanceTimersByTime(2_000);
    await expect(cache.get("k")).resolves.toBeUndefined();
  });

  it("overwriting a key resets its TTL from the overwrite time", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("k", "v1", 10);
    vi.advanceTimersByTime(8_000);
    await cache.set("k", "v2", 10);
    vi.advanceTimersByTime(8_000);
    await expect(cache.get("k")).resolves.toBe("v2");
  });

  it("keeps independent keys independent", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("a", "1", 60);
    await cache.set("b", "2", 60);
    await expect(cache.get("a")).resolves.toBe("1");
    await expect(cache.get("b")).resolves.toBe("2");
  });
});
