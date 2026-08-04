import { describe, expect, it } from "vitest";

import { buildRateLimitKey, toIpPrefix } from "@/domain/rate-limit/rate-limit-key";
import { InMemoryRateLimiter } from "@/server/services/rate-limit/in-memory-rate-limiter";

describe("buildRateLimitKey / toIpPrefix (§16 - never stores raw identifiers)", () => {
  it("produces a deterministic hash, not the raw identifier", () => {
    const key = buildRateLimitKey("login", "user@example.com", "1.2.3.0/24");
    expect(key).not.toContain("user@example.com");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case/whitespace-insensitive on the identifier", () => {
    const a = buildRateLimitKey("login", "USER@example.com ", "1.2.3.0/24");
    const b = buildRateLimitKey("login", " user@example.com", "1.2.3.0/24");
    expect(a).toBe(b);
  });

  it("different purposes never collide on the same identifier/ip", () => {
    const a = buildRateLimitKey("login", "user@example.com", "1.2.3.0/24");
    const b = buildRateLimitKey("signup", "user@example.com", "1.2.3.0/24");
    expect(a).not.toBe(b);
  });

  it("coarsens an IPv4 address to a /24 prefix", () => {
    expect(toIpPrefix("203.0.113.42")).toBe("203.0.113.0/24");
  });

  it("falls back to unknown for a malformed IP", () => {
    expect(toIpPrefix("not-an-ip")).toBe("unknown");
    expect(toIpPrefix("")).toBe("unknown");
  });
});

describe("InMemoryRateLimiter (§46)", () => {
  it("allows requests within the limit", async () => {
    const limiter = new InMemoryRateLimiter();
    const key = "test-key-1";
    for (let i = 0; i < 5; i++) {
      const result = await limiter.consume({ key, limit: 5, windowSeconds: 60 });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks once the limit is exceeded within the window", async () => {
    const limiter = new InMemoryRateLimiter();
    const key = "test-key-2";
    for (let i = 0; i < 3; i++) {
      await limiter.consume({ key, limit: 3, windowSeconds: 60 });
    }
    const result = await limiter.consume({ key, limit: 3, windowSeconds: 60 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after the window elapses", async () => {
    const limiter = new InMemoryRateLimiter();
    const key = "test-key-3";
    const originalNow = Date.now;
    let currentTime = originalNow();
    Date.now = () => currentTime;

    try {
      for (let i = 0; i < 2; i++) {
        await limiter.consume({ key, limit: 2, windowSeconds: 1 });
      }
      const blocked = await limiter.consume({ key, limit: 2, windowSeconds: 1 });
      expect(blocked.allowed).toBe(false);

      currentTime += 1100; // advance past the 1s window
      const afterReset = await limiter.consume({ key, limit: 2, windowSeconds: 1 });
      expect(afterReset.allowed).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("tracks separate keys independently", async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.consume({ key: "a", limit: 1, windowSeconds: 60 });
    const blockedA = await limiter.consume({ key: "a", limit: 1, windowSeconds: 60 });
    const allowedB = await limiter.consume({ key: "b", limit: 1, windowSeconds: 60 });
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});
