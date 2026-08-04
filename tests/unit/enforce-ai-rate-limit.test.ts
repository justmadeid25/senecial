import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryRateLimiter } from "@/server/services/rate-limit/in-memory-rate-limiter";

let limiter = new InMemoryRateLimiter();

vi.mock("@/lib/http/client-ip", () => ({
  getClientIpPrefix: async () => "203.0.113.0/24",
}));

vi.mock("@/server/services/rate-limit", () => ({
  getRateLimiter: () => limiter,
}));

const { enforceRateLimit } = await import("@/lib/rate-limit/enforce-rate-limit");
const { RateLimitError } = await import("@/lib/errors");
const { RATE_LIMIT_BUDGETS } = await import("@/lib/config/rate-limit");

describe("enforceRateLimit(\"aiAsk\") (Phase 12 §Security - AI-specific rate limit, separate from every other purpose)", () => {
  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  it("has its own budget, independent from every other rate-limited purpose", () => {
    expect(RATE_LIMIT_BUDGETS.aiAsk).toBeDefined();
    expect(RATE_LIMIT_BUDGETS.aiAsk.limit).toBeGreaterThan(0);
    expect(RATE_LIMIT_BUDGETS.aiAsk.windowSeconds).toBeGreaterThan(0);
  });

  it("allows requests within budget", async () => {
    await expect(enforceRateLimit("aiAsk", "user-1")).resolves.toBeUndefined();
  });

  it("throws RateLimitError once the same user's budget is exhausted", async () => {
    const { limit } = RATE_LIMIT_BUDGETS.aiAsk;
    for (let i = 0; i < limit; i += 1) {
      await enforceRateLimit("aiAsk", "user-2");
    }
    await expect(enforceRateLimit("aiAsk", "user-2")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("scopes the budget per-user - one user's exhausted budget never blocks another user", async () => {
    const { limit } = RATE_LIMIT_BUDGETS.aiAsk;
    for (let i = 0; i < limit; i += 1) {
      await enforceRateLimit("aiAsk", "heavy-user");
    }
    await expect(enforceRateLimit("aiAsk", "heavy-user")).rejects.toBeInstanceOf(RateLimitError);
    await expect(enforceRateLimit("aiAsk", "other-user")).resolves.toBeUndefined();
  });

  it("consuming a DIFFERENT purpose's budget never affects aiAsk's own budget", async () => {
    const { limit } = RATE_LIMIT_BUDGETS.aiAsk;
    for (let i = 0; i < limit; i += 1) {
      await enforceRateLimit("csvExport", "shared-user");
    }
    await expect(enforceRateLimit("aiAsk", "shared-user")).resolves.toBeUndefined();
  });
});
