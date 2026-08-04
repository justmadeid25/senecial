/**
 * §Phase 12.2 Part E (§33 AI concurrency limit) - a SEMAPHORE (acquire one
 * slot, hold it for the duration of a request, release it when done),
 * distinct from RateLimiter (domain/rate-limit/rate-limiter.ts, a
 * throughput/window counter). The two solve different problems: rate
 * limiting bounds how many AI requests a user/org can START per window;
 * this bounds how many can be IN FLIGHT at once, regardless of how spread
 * out over time they were - relevant because a single AI request (a
 * streaming LLM call) can hold a connection open far longer than a normal
 * request, so a generous throughput budget could still let one user pile
 * up many slow concurrent requests.
 */
export interface ConcurrencyAcquireResult {
  acquired: boolean;
  currentCount: number;
}

export interface ConcurrencyLimiter {
  /** Never blocks/waits - returns immediately with acquired:false if the limit is already reached. */
  acquire(key: string, maxConcurrent: number, leaseSeconds: number): Promise<ConcurrencyAcquireResult>;
  /** Releases a previously acquired slot. Safe to call even if the matching acquire() failed (no-op in that case). */
  release(key: string): Promise<void>;
}
