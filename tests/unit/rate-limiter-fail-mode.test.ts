import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimiter, RateLimiterConsumeInput, RateLimiterConsumeResult } from "@/domain/rate-limit/rate-limiter";

/**
 * Phase 14 Part 3 (failure injection - Redis unavailable). Simulates the
 * real behavior observed against a live Redis outage: RedisRateLimiter's
 * own consume() deliberately lets connection/timeout errors propagate
 * as-is (see its docstring) rather than interpreting them - this is the
 * one call site (enforceRateLimit/enforceLoginRateLimit) responsible for
 * applying RATE_LIMIT_FAIL_MODE. Before this fix, that env var was parsed
 * but never actually read anywhere, so every call site's `catch (e) { if
 * (e instanceof RateLimitError) {...}; throw e; }` pattern re-threw the
 * raw connection error as an unhandled exception regardless of the
 * configured mode - this test locks in the intended, controlled behavior
 * instead.
 */
class ThrowingRateLimiter implements RateLimiter {
  consume(_input: RateLimiterConsumeInput): Promise<RateLimiterConsumeResult> {
    return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
  }
}

let limiter: RateLimiter = new ThrowingRateLimiter();

vi.mock("@/lib/http/client-ip", () => ({
  getClientIpPrefix: async () => "203.0.113.0/24",
}));

vi.mock("@/server/services/rate-limit", () => ({
  getRateLimiter: () => limiter,
}));

const { enforceRateLimit, enforceLoginRateLimit } = await import("@/lib/rate-limit/enforce-rate-limit");
const { RateLimitError } = await import("@/lib/errors");

describe("rate limiter unavailable (RATE_LIMIT_FAIL_MODE)", () => {
  const originalFailMode = process.env.RATE_LIMIT_FAIL_MODE;

  beforeEach(() => {
    limiter = new ThrowingRateLimiter();
  });

  afterEach(() => {
    if (originalFailMode === undefined) {
      delete process.env.RATE_LIMIT_FAIL_MODE;
    } else {
      process.env.RATE_LIMIT_FAIL_MODE = originalFailMode;
    }
  });

  describe("default (closed) - the documented default", () => {
    beforeEach(() => {
      delete process.env.RATE_LIMIT_FAIL_MODE;
    });

    it("enforceRateLimit throws a clean RateLimitError instead of the raw connection error", async () => {
      const result = enforceRateLimit("aiAsk", "user-1");
      await expect(result).rejects.toBeInstanceOf(RateLimitError);
      await expect(result).rejects.not.toThrow(/ECONNREFUSED/);
    });

    it("enforceLoginRateLimit throws a clean RateLimitError instead of the raw connection error", async () => {
      const result = enforceLoginRateLimit("user@example.com");
      await expect(result).rejects.toBeInstanceOf(RateLimitError);
      await expect(result).rejects.not.toThrow(/ECONNREFUSED/);
    });
  });

  describe('RATE_LIMIT_FAIL_MODE=open - explicit, audited opt-out', () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_FAIL_MODE = "open";
    });

    it("enforceRateLimit allows the request through", async () => {
      await expect(enforceRateLimit("aiAsk", "user-1")).resolves.toBeUndefined();
    });

    it("enforceLoginRateLimit allows the request through", async () => {
      await expect(enforceLoginRateLimit("user@example.com")).resolves.toBeUndefined();
    });
  });

  describe("any other value falls back to closed (safe default)", () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_FAIL_MODE = "not-a-real-mode";
    });

    it("enforceRateLimit still throws RateLimitError", async () => {
      await expect(enforceRateLimit("aiAsk", "user-1")).rejects.toBeInstanceOf(RateLimitError);
    });
  });
});
