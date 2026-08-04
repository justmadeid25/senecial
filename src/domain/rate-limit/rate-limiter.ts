export interface RateLimiterConsumeInput {
  /** Pre-hashed key (see rate-limit-key.ts) - never a raw email/IP. */
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimiterConsumeResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Extension point for rate limiting. `InMemoryRateLimiter` (the default,
 * see server/services/rate-limit) is process-local and does not coordinate
 * across multiple app instances - real horizontal-scale deployments should
 * implement this against Redis (`RedisRateLimiter`) or a shared table
 * (`DatabaseRateLimiter`); neither is implemented in this Phase (Redis is
 * explicitly out of scope - see README), this interface is what a future
 * driver would implement.
 */
export interface RateLimiter {
  consume(input: RateLimiterConsumeInput): Promise<RateLimiterConsumeResult>;
}
