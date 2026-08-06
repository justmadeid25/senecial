import { randomUUID } from "node:crypto";

import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRedisConfig } from "@/lib/config/redis";
import { getAiBudgetRedisClient } from "@/server/services/ai/budget/redis-budget-client";
import { RedisBudgetCounter } from "@/server/services/ai/budget/redis-budget-counter";
import { getAiCircuitBreakerRedisClient } from "@/server/services/ai/circuit-breaker/redis-circuit-breaker-client";
import { RedisCircuitBreaker } from "@/server/services/ai/circuit-breaker/redis-circuit-breaker";

/**
 * §Phase 13 Part E/G (§17/§27) - REAL network round-trip tests against an
 * actually-running Redis server, never a mock/fake client - matches
 * tests/integration/redis-ai-infrastructure-real.test.ts's exact
 * convention (skipped, not failed, unless TEST_REDIS_URL is set; unique
 * key prefix per run; cleanup in afterAll). To run for real:
 *
 *   TEST_REDIS_URL=redis://localhost:6379 \
 *   pnpm exec dotenv -e .env.test -- vitest run tests/integration/redis-ai-circuit-breaker-and-budget-real.test.ts
 */
const testRedisUrl = process.env.TEST_REDIS_URL;
const hasRedisConfig = Boolean(testRedisUrl);

describe.skipIf(!hasRedisConfig)("Redis AI circuit breaker + budget counter against real Redis (Phase 13 §17/§27)", () => {
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

  describe("RedisCircuitBreaker (§17)", () => {
    let breaker: RedisCircuitBreaker;
    const config = { failureThreshold: 3, failureWindowSeconds: 60, openDurationSeconds: 1, probeTimeoutMs: 500 };

    beforeAll(() => {
      const redisConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: keyPrefix });
      const client = getAiCircuitBreakerRedisClient(redisConfig);
      breaker = new RedisCircuitBreaker(client, config);
    });

    it("opens after reaching the failure threshold, sharing state across a second connection (simulating a second process)", async () => {
      const key = `provider-${randomUUID()}`;
      for (let i = 0; i < config.failureThreshold; i++) {
        await breaker.onFailure(key);
      }
      expect(await breaker.getState(key)).toBe("OPEN");

      const secondRedisConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: keyPrefix });
      const secondClient = getAiCircuitBreakerRedisClient(secondRedisConfig);
      const secondBreaker = new RedisCircuitBreaker(secondClient, config);
      const token = await secondBreaker.beforeCall(key);
      expect(token.allowed).toBe(false);
      expect(token.state).toBe("OPEN");
    });

    it("transitions to HALF_OPEN and allows exactly one real concurrent probe (atomic under 10 real concurrent callers)", async () => {
      const key = `probe-race-${randomUUID()}`;
      for (let i = 0; i < config.failureThreshold; i++) {
        await breaker.onFailure(key);
      }
      await new Promise((resolve) => setTimeout(resolve, config.openDurationSeconds * 1000 + 50));

      const tokens = await Promise.all(Array.from({ length: 10 }, () => breaker.beforeCall(key)));
      expect(tokens.filter((t) => t.allowed)).toHaveLength(1);
    });

    it("a success in HALF_OPEN closes the circuit for real", async () => {
      const key = `close-${randomUUID()}`;
      for (let i = 0; i < config.failureThreshold; i++) {
        await breaker.onFailure(key);
      }
      await new Promise((resolve) => setTimeout(resolve, config.openDurationSeconds * 1000 + 50));
      await breaker.beforeCall(key);
      await breaker.onSuccess(key);
      expect(await breaker.getState(key)).toBe("CLOSED");
    });
  });

  describe("RedisBudgetCounter (§27)", () => {
    let counter: RedisBudgetCounter;

    beforeAll(() => {
      const redisConfig = resolveRedisConfig({ ...process.env, REDIS_URL: testRedisUrl, REDIS_KEY_PREFIX: keyPrefix });
      const client = getAiBudgetRedisClient(redisConfig);
      counter = new RedisBudgetCounter(client);
    });

    it("20 real concurrent reservations against a limit of 100 (each 10) admit EXACTLY 10, never more (atomicity under real concurrency)", async () => {
      const key = `budget-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 20 }, () => counter.reserve(key, 10, 100, 3600)));
      expect(results.filter((r) => r.reserved)).toHaveLength(10);
    });

    it("adjust and release correctly mutate the real stored value", async () => {
      const key = `settle-${randomUUID()}`;
      await counter.reserve(key, 100, 1000, 3600);
      await counter.adjust(key, -30);
      const afterAdjust = await counter.reserve(key, 0, 1000, 3600);
      expect(afterAdjust.currentValue).toBe(70);

      await counter.release(key, 70);
      const afterRelease = await counter.reserve(key, 0, 1000, 3600);
      expect(afterRelease.currentValue).toBe(0);
    });
  });
});
