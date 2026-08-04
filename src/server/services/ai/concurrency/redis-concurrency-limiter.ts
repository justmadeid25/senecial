import type { ConcurrencyAcquireResult, ConcurrencyLimiter } from "@/domain/ai/concurrency-limiter";

import type { RedisWithConcurrencyCommands } from "./redis-concurrency-client";

/** Real (not a stub) Redis-backed semaphore - see redis-concurrency-lua-scripts.ts for the atomic acquire/release logic. */
export class RedisConcurrencyLimiter implements ConcurrencyLimiter {
  constructor(private readonly client: RedisWithConcurrencyCommands) {}

  async acquire(key: string, maxConcurrent: number, leaseSeconds: number): Promise<ConcurrencyAcquireResult> {
    const [acquired, currentCount] = await this.client.acquireConcurrencySlot(key, maxConcurrent, leaseSeconds);
    return { acquired: acquired === 1, currentCount };
  }

  async release(key: string): Promise<void> {
    await this.client.releaseConcurrencySlot(key);
  }
}
