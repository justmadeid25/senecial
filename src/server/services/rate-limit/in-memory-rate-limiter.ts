import type { RateLimiter, RateLimiterConsumeInput, RateLimiterConsumeResult } from "@/domain/rate-limit/rate-limiter";

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Fixed-window counter, process-local only (see RateLimiter's docstring
 * for why that is not safe for a multi-instance production deployment
 * without ALLOW_IN_MEMORY_RATE_LIMITER=true). A bucket's window resets
 * once `windowSeconds` has elapsed since the first request in that
 * window - not a rolling/sliding window, which is a deliberate
 * simplification appropriate for abuse-throttling (not billing-grade
 * precision).
 *
 * Expired buckets are swept opportunistically on each consume() call
 * rather than via a background timer, so this class needs no
 * start()/stop() lifecycle and cannot leak an interval handle.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  async consume(input: RateLimiterConsumeInput): Promise<RateLimiterConsumeResult> {
    const now = Date.now();
    this.sweepIfDue(now);

    const windowMs = input.windowSeconds * 1000;
    const existing = this.buckets.get(input.key);

    if (!existing || now - existing.windowStart >= windowMs) {
      this.buckets.set(input.key, { count: 1, windowStart: now });
      return { allowed: true, remaining: input.limit - 1, resetAt: new Date(now + windowMs) };
    }

    const resetAt = new Date(existing.windowStart + windowMs);
    if (existing.count >= input.limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    existing.count += 1;
    return { allowed: true, remaining: input.limit - existing.count, resetAt };
  }

  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < InMemoryRateLimiter.SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      // A bucket can only grow stale relative to *some* window, but this
      // class does not know per-key windowSeconds outside consume() - an
      // hour is a safe upper bound for every purpose configured in
      // lib/config/rate-limit.ts today.
      if (now - bucket.windowStart > 60 * 60 * 1000) {
        this.buckets.delete(key);
      }
    }
  }
}
