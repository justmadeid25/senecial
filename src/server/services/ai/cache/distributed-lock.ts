import type { Redis } from "ioredis";

import { getLogger } from "@/server/logging";

/**
 * §Phase 12.2 Part F (§35 Cache stampede) - cross-INSTANCE coordination,
 * complementing (not replacing) in-flight-deduplication.ts's in-process
 * layer. Only meaningful when AI_CACHE_PROVIDER=redis (multiple server
 * instances sharing one Redis) - the in-memory cache provider has no
 * multi-instance concept, so nothing implements this interface for it.
 */
export interface DistributedLock {
  /** Returns true if the lock was acquired, false if another holder already has it. Never blocks waiting for the lock itself - that's the caller's job (see withDistributedLockOrCompute below), bounded by MAX_WAIT_MS. */
  tryAcquire(key: string, leaseSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

const LOCK_KEY_PREFIX = "stampede-lock:";

/** Real (not a stub) Redis-backed lock using SET NX EX - atomic acquire, TTL-bounded so a crashed holder never wedges the lock forever. */
export class RedisDistributedLock implements DistributedLock {
  constructor(private readonly client: Redis) {}

  async tryAcquire(key: string, leaseSeconds: number): Promise<boolean> {
    const result = await this.client.set(`${LOCK_KEY_PREFIX}${key}`, "1", "EX", Math.max(1, leaseSeconds), "NX");
    return result === "OK";
  }

  async release(key: string): Promise<void> {
    await this.client.del(`${LOCK_KEY_PREFIX}${key}`);
  }
}

const MAX_WAIT_MS = 3000;
const POLL_INTERVAL_MS = 50;

/**
 * §35 - "lock 실패 시 무한 대기하지 마십시오": if another instance holds
 * the lock, wait up to MAX_WAIT_MS polling the cache for its result; if it
 * never shows up (the holder died, or is just slow), compute independently
 * rather than wait forever - a duplicated computation is always correct
 * (same philosophy as every cache miss elsewhere in this codebase), an
 * indefinite wait is not.
 */
export async function withDistributedLockOrCompute<T>(
  lock: DistributedLock,
  key: string,
  leaseSeconds: number,
  pollForResult: () => Promise<T | undefined>,
  compute: () => Promise<T>
): Promise<T> {
  const acquired = await lock.tryAcquire(key, leaseSeconds);
  if (acquired) {
    try {
      // Re-check: another instance may have finished and published its
      // result between our caller's own cache-miss check and this acquire.
      const recheck = await pollForResult();
      if (recheck !== undefined) {
        return recheck;
      }
      return await compute();
    } finally {
      await lock.release(key);
    }
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const polled = await pollForResult();
    if (polled !== undefined) {
      return polled;
    }
  }

  getLogger().warn("ai_cache.stampede_lock_wait_timeout", { key });
  return compute();
}
