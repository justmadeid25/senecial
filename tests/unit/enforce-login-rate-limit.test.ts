import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryRateLimiter } from "@/server/services/rate-limit/in-memory-rate-limiter";

let fakeIpPrefix = "203.0.113.0/24";
let limiter = new InMemoryRateLimiter();

vi.mock("@/lib/http/client-ip", () => ({
  getClientIpPrefix: async () => fakeIpPrefix,
}));

vi.mock("@/server/services/rate-limit", () => ({
  getRateLimiter: () => limiter,
}));

const { enforceLoginRateLimit } = await import("@/lib/rate-limit/enforce-rate-limit");
const { RateLimitError } = await import("@/lib/errors");

describe("enforceLoginRateLimit (Phase 10A §19 - multi-axis login limiting)", () => {
  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
    fakeIpPrefix = "203.0.113.0/24";
  });

  it("allows attempts within every axis's budget", async () => {
    await expect(enforceLoginRateLimit("user@example.com")).resolves.toBeUndefined();
  });

  it("blocks once the identifier-only axis (rotating IP against one email) is exhausted", async () => {
    // loginByIdentifier defaults to limit=10 - exhaust it by rotating the IP each call.
    for (let i = 0; i < 10; i++) {
      fakeIpPrefix = `203.0.113.${i}/24`;
      await enforceLoginRateLimit("victim@example.com");
    }
    fakeIpPrefix = "203.0.113.99/24"; // yet another new IP - only the identifier axis should now be exhausted
    await expect(enforceLoginRateLimit("victim@example.com")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("blocks once the IP-only axis (rotating email against one IP) is exhausted", async () => {
    // loginByIp defaults to limit=30 - exhaust it by rotating the email each call.
    fakeIpPrefix = "198.51.100.0/24";
    for (let i = 0; i < 30; i++) {
      await enforceLoginRateLimit(`user-${i}@example.com`);
    }
    await expect(enforceLoginRateLimit("user-final@example.com")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("consumes all three axes on every call, not just the first one that would block", async () => {
    const consumeSpy = vi.spyOn(limiter, "consume");
    await enforceLoginRateLimit("axis-check@example.com");
    expect(consumeSpy).toHaveBeenCalledTimes(3);
  });

  it("a successful call never fully blocks a distinct (email, ip) pair sharing only one axis", async () => {
    fakeIpPrefix = "203.0.113.5/24";
    await enforceLoginRateLimit("shared-ip-user-1@example.com");
    fakeIpPrefix = "203.0.113.5/24";
    await expect(enforceLoginRateLimit("shared-ip-user-2@example.com")).resolves.toBeUndefined();
  });
});
