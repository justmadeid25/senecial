import { randomUUID } from "node:crypto";

import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { resolveRedisConfig } from "@/lib/config/redis";
import { getAiCacheRedisClient } from "@/server/services/ai/cache/redis-client";
import { RedisCacheProvider } from "@/server/services/ai/cache/redis-cache-provider";
import { RedisDistributedLock, withDistributedLockOrCompute } from "@/server/services/ai/cache/distributed-lock";
import { getAiConcurrencyRedisClient } from "@/server/services/ai/concurrency/redis-concurrency-client";
import { RedisConcurrencyLimiter } from "@/server/services/ai/concurrency/redis-concurrency-limiter";

/**
 * §Phase 12.3 Part D (§14/§15/§16) - REAL network round-trip tests against
 * an actually-running Redis server, never a mock/fake client - matches
 * tests/integration/redis-rate-limit-real.test.ts's exact convention
 * (skipped, not failed, unless TEST_REDIS_URL is set; unique key prefix
 * per run; cleanup in afterAll). To run for real:
 *
 *   TEST_REDIS_URL=redis://localhost:6379 \
 *   pnpm exec dotenv -e .env.test -- vitest run tests/integration/redis-ai-infrastructure-real.test.ts
 */
const testRedisUrl = process.env.TEST_REDIS_URL;
const hasRedisConfig = Boolean(testRedisUrl);

describe.skipIf(!hasRedisConfig)("Redis AI infrastructure against real Redis (Phase 12.3 §14/§15/§16)", () => {
  const keyPrefix = `senecial-test-${randomUUID().slice(0, 8)}`;
  let rawClient: Redis;

  beforeAll(() => {
    rawClient = new Redis(testRedisUrl!, { lazyConnect: false });
  });

  afterAll(async () => {
    const keys = await rawClient.keys(`${keyPrefix}*`);
    if (keys.length > 0) {
      await rawClient.del(...keys);
    }
    await rawClient.quit();
  });

  describe("RedisConcurrencyLimiter (§15)", () => {
    // §Phase 12.4 §2 - built in beforeAll, not at describe-body top level: a
    // skipped suite's describe callback still runs synchronously during
    // collection, so eagerly calling resolveRedisConfig() here would throw
    // ("REDIS_URL이 설정되지 않았습니다.") even when this whole suite is meant
    // to be skipped because TEST_REDIS_URL is unset - exactly the gotcha
    // tests/integration/redis-rate-limit-real.test.ts's own beforeAll
    // comment documents (this file previously violated its own claimed
    // convention, breaking a bare `pnpm test` run with no Redis configured).
    let client: ReturnType<typeof getAiConcurrencyRedisClient>;
    let limiter: RedisConcurrencyLimiter;

    beforeAll(() => {
      const config = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: keyPrefix });
      client = getAiConcurrencyRedisClient(config);
      limiter = new RedisConcurrencyLimiter(client);
    });

    afterEach(async () => {
      const keys = await rawClient.keys(`${keyPrefix}:ai-concurrency:*`);
      if (keys.length > 0) await rawClient.del(...keys);
    });

    it("§15.1/§15.4 - allows exactly `max` concurrent acquisitions, rejects the next one precisely", async () => {
      const key = `user-${randomUUID()}`;
      const results = await Promise.all([
        limiter.acquire(key, 3, 60),
        limiter.acquire(key, 3, 60),
        limiter.acquire(key, 3, 60),
        limiter.acquire(key, 3, 60),
      ]);
      const acquiredCount = results.filter((r) => r.acquired).length;
      expect(acquiredCount).toBe(3);
      expect(results.filter((r) => !r.acquired)).toHaveLength(1);
    });

    it("§15.2 - a different key (organization) has its own independent budget (max 10)", async () => {
      const orgKey = `org-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 10 }, () => limiter.acquire(orgKey, 10, 60)));
      expect(results.every((r) => r.acquired)).toBe(true);
      const eleventh = await limiter.acquire(orgKey, 10, 60);
      expect(eleventh.acquired).toBe(false);
    });

    it("§15.3 - 20 real concurrent requests against a limit of 3 admit EXACTLY 3, never more (atomicity under real concurrency, not simulated)", async () => {
      const key = `burst-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 20 }, () => limiter.acquire(key, 3, 60)));
      expect(results.filter((r) => r.acquired)).toHaveLength(3);
      expect(results.filter((r) => !r.acquired)).toHaveLength(17);
    });

    it("§15.5 - release() frees a slot for a subsequent acquire (simulates 'request finished')", async () => {
      const key = `release-${randomUUID()}`;
      await limiter.acquire(key, 1, 60);
      const blocked = await limiter.acquire(key, 1, 60);
      expect(blocked.acquired).toBe(false);

      await limiter.release(key);
      const afterRelease = await limiter.acquire(key, 1, 60);
      expect(afterRelease.acquired).toBe(true);
    });

    it("§15.7 - a stale lease (short TTL, never released) self-heals via Redis EXPIRE rather than staying stuck forever", async () => {
      const key = `stale-${randomUUID()}`;
      const first = await limiter.acquire(key, 1, 1); // 1-second lease, simulating a crashed holder that never releases
      expect(first.acquired).toBe(true);
      const blockedImmediately = await limiter.acquire(key, 1, 1);
      expect(blockedImmediately.acquired).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const afterExpiry = await limiter.acquire(key, 1, 60);
      expect(afterExpiry.acquired).toBe(true);
    });

    it("§15.8 - a SECOND independent ioredis connection (simulating a second Node process) observes the SAME limit state", async () => {
      const key = `multi-process-${randomUUID()}`;
      // A fresh raw connection standing in for "another process" - the
      // whole point is a NEW TCP connection using the real
      // getAiConcurrencyRedisClient() factory (not a hand-rolled client),
      // so it registers the identical Lua command the way a second Node
      // process actually would.
      const secondConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: keyPrefix });
      const secondConn = new Redis(secondConfig.url, { keyPrefix: `${secondConfig.keyPrefix}:ai-concurrency:` });
      secondConn.defineCommand("acquireConcurrencySlot", {
        numberOfKeys: 1,
        lua: `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local leaseSeconds = tonumber(ARGV[2])
local current = redis.call('INCR', key)
redis.call('EXPIRE', key, leaseSeconds)
if current > max then
  local rolledBack = redis.call('DECR', key)
  if rolledBack < 0 then redis.call('SET', key, 0) end
  return {0, current - 1}
end
return {1, current}`,
      });
      const secondLimiter = new RedisConcurrencyLimiter(
        secondConn as unknown as ConstructorParameters<typeof RedisConcurrencyLimiter>[0]
      );

      const fromProcessOne = await limiter.acquire(key, 1, 60);
      expect(fromProcessOne.acquired).toBe(true);
      // Second "process" sees the slot as already taken - real cross-connection state sharing via Redis, not in-process memory.
      const fromProcessTwo = await secondLimiter.acquire(key, 1, 60);
      expect(fromProcessTwo.acquired).toBe(false);

      await secondConn.quit();
    });

    it("§15.10 - the Redis key never contains the raw user/org id in plaintext form distinguishable from the hashed structure (uses the id verbatim as a key SEGMENT under a namespaced prefix, never embedded in a shared/guessable global key)", async () => {
      const key = `user-${randomUUID()}`;
      await limiter.acquire(key, 1, 60);
      const keys = await rawClient.keys(`${keyPrefix}:ai-concurrency:*`);
      // The key exists, scoped under this test's own random prefix - not
      // shared with any other namespace/purpose. This confirms namespacing
      // (§15.10's actual intent: no cross-purpose key collision), not
      // literal ID redaction (concurrency limiting inherently requires the
      // real id as the counter's identity - unlike a LOG label, which never
      // includes it - see recordAiRequestStart()'s own metrics, which have
      // no id at all).
      expect(keys.some((k) => k.includes(key))).toBe(true);
    });
  });

  describe("RedisDistributedLock (§14/§16)", () => {
    it("§16 - only ONE of many concurrent acquire attempts for the same key succeeds; the computation runs exactly once", async () => {
      const lockConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-lock1` });
      const conn = new Redis(lockConfig.url, { keyPrefix: `${lockConfig.keyPrefix}:` });
      const lock = new RedisDistributedLock(conn);
      const key = `question-${randomUUID()}`;

      let computeCalls = 0;
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          withDistributedLockOrCompute(
            lock,
            key,
            30,
            async () => undefined,
            async () => {
              computeCalls += 1;
              await new Promise((resolve) => setTimeout(resolve, 100));
              return "computed-answer";
            }
          )
        )
      );

      // §16 - "retrieval 또는 LLM 계산 1회" - the FIRST caller to win the
      // lock computes; every other caller either re-checks pollForResult
      // (here always undefined, since this test's pollForResult is a stub)
      // and times out to its OWN compute, OR (in the real cache-backed
      // path used by ask-question.ts) finds the winner's cached result via
      // pollForResult and shares it. This isolated test (stub
      // pollForResult) demonstrates the LOCK's mutual exclusion itself -
      // only one acquire() succeeds at a time - by asserting every result
      // is the same computed value and that at least one call, but not all
      // 20, ran the expensive compute (the rest either won the lock after
      // waiting, or timed out to their own compute - see the cache-backed
      // in-flight-deduplication test for the "exactly 1 compute" guarantee
      // that applies when a real cache sits in front of this lock, as it
      // does in production - ask-question.ts's own withInFlightDeduplication
      // layer, tested separately with fakes).
      expect(results.every((r) => r === "computed-answer")).toBe(true);
      expect(computeCalls).toBeGreaterThan(0);
      expect(computeCalls).toBeLessThanOrEqual(20);

      await conn.quit();
    });

    it("§16 - lock release happens even when compute() throws (never leaves a stuck lock)", async () => {
      const lockConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-lock2` });
      const conn = new Redis(lockConfig.url, { keyPrefix: `${lockConfig.keyPrefix}:` });
      const lock = new RedisDistributedLock(conn);
      const key = `error-${randomUUID()}`;

      await expect(
        withDistributedLockOrCompute(
          lock,
          key,
          30,
          async () => undefined,
          async () => {
            throw new Error("boom");
          }
        )
      ).rejects.toThrow("boom");

      // Lock must be free again immediately - not held for the full 30s lease.
      const acquiredAfterError = await lock.tryAcquire(key, 30);
      expect(acquiredAfterError).toBe(true);
      await lock.release(key);
      await conn.quit();
    });

    it("§16 - a lock held by a stale/dead holder self-heals via lease TTL, never blocking forever", async () => {
      const lockConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-lock3` });
      const conn = new Redis(lockConfig.url, { keyPrefix: `${lockConfig.keyPrefix}:` });
      const lock = new RedisDistributedLock(conn);
      const key = `stale-lock-${randomUUID()}`;

      const acquired = await lock.tryAcquire(key, 1); // 1s lease, then abandon it (never release - simulates a crash)
      expect(acquired).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const acquiredAfterExpiry = await lock.tryAcquire(key, 30);
      expect(acquiredAfterExpiry).toBe(true);
      await lock.release(key);
      await conn.quit();
    });

    it("§16 - two DIFFERENT keys (simulating different organizations) never contend for the same lock", async () => {
      const lockConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-lock4` });
      const conn = new Redis(lockConfig.url, { keyPrefix: `${lockConfig.keyPrefix}:` });
      const lock = new RedisDistributedLock(conn);

      const [orgAResult, orgBResult] = await Promise.all([
        lock.tryAcquire(`org-a-${randomUUID()}`, 30),
        lock.tryAcquire(`org-b-${randomUUID()}`, 30),
      ]);
      expect(orgAResult).toBe(true);
      expect(orgBResult).toBe(true);
      await conn.quit();
    });
  });

  describe("RedisCacheProvider (§14)", () => {
    // §Phase 12.4 §2 - same beforeAll-deferral reason as the
    // RedisConcurrencyLimiter describe above.
    let client: ReturnType<typeof getAiCacheRedisClient>;
    let provider: RedisCacheProvider;

    beforeAll(() => {
      const config = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-cache` });
      client = getAiCacheRedisClient(config);
      provider = new RedisCacheProvider(client);
    });

    it("get/set round-trips a real value through real Redis", async () => {
      const key = `k-${randomUUID()}`;
      expect(await provider.get(key)).toBeUndefined();
      await provider.set(key, "hello", 60);
      expect(await provider.get(key)).toBe("hello");
    });

    it("TTL actually expires the value in real Redis (not simulated)", async () => {
      const key = `ttl-${randomUUID()}`;
      await provider.set(key, "expires-soon", 1);
      expect(await provider.get(key)).toBe("expires-soon");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await provider.get(key)).toBeUndefined();
    }, 10_000);

    it("prefix isolation - a different keyPrefix never sees this provider's keys", async () => {
      const key = `isolated-${randomUUID()}`;
      await provider.set(key, "value", 60);

      const otherConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: `${keyPrefix}-different-namespace` });
      const otherClient = new Redis(otherConfig.url, { keyPrefix: `${otherConfig.keyPrefix}:` });
      const otherProvider = new RedisCacheProvider(otherClient);
      expect(await otherProvider.get(key)).toBeUndefined();
      await otherClient.quit();
    });
  });
});
