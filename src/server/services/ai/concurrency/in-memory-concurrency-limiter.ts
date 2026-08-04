import type { ConcurrencyAcquireResult, ConcurrencyLimiter } from "@/domain/ai/concurrency-limiter";

/**
 * Process-local only (see get-ai-concurrency-limiter.ts's production
 * guard, same pattern as InMemoryRateLimiter/InMemoryCacheProvider) - a
 * plain in-memory counter per key. `leaseSeconds` is unused here (nothing
 * to expire - a process crash simply loses the whole Map, which is fine
 * for a single process) but kept in the signature to match the interface
 * the Redis implementation also satisfies.
 */
export class InMemoryConcurrencyLimiter implements ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  async acquire(key: string, maxConcurrent: number): Promise<ConcurrencyAcquireResult> {
    const current = this.counts.get(key) ?? 0;
    if (current >= maxConcurrent) {
      return { acquired: false, currentCount: current };
    }
    const next = current + 1;
    this.counts.set(key, next);
    return { acquired: true, currentCount: next };
  }

  async release(key: string): Promise<void> {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, current - 1);
    }
  }
}
