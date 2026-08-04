import type { RateLimiter, RateLimiterConsumeInput, RateLimiterConsumeResult } from "@/domain/rate-limit/rate-limiter";
import { recordDependencyLatency } from "@/server/monitoring/metrics";

import type { RedisWithRateLimitCommands } from "./redis-client";

/**
 * Coordinates across every app instance sharing the same Redis (unlike
 * `InMemoryRateLimiter`), via the atomic `consumeRateLimit` Lua command
 * (see redis-lua-scripts.ts for why this must be one atomic script rather
 * than separate GET/INCR/EXPIRE calls).
 *
 * Deliberately does NOT catch/interpret connection or timeout errors here
 * - `consume()` lets them propagate as-is. §20's fail-open/fail-closed
 * policy is applied one layer up, at the `enforceRateLimit()` call site,
 * because that is the layer that knows the safe user-facing message and
 * the per-purpose semantics; this class's only job is "ask Redis,
 * atomically."
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly client: RedisWithRateLimitCommands) {}

  async consume(input: RateLimiterConsumeInput): Promise<RateLimiterConsumeResult> {
    const start = performance.now();
    let allowed: number, remaining: number, pttlMs: number;
    try {
      [allowed, remaining, pttlMs] = await this.client.consumeRateLimit(input.key, input.limit, input.windowSeconds);
    } finally {
      recordDependencyLatency("redis", performance.now() - start);
    }

    return {
      allowed: allowed === 1,
      remaining,
      resetAt: new Date(Date.now() + pttlMs),
    };
  }
}
