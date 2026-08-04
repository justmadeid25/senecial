import { randomUUID } from "node:crypto";

import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRedisConfig } from "@/lib/config/redis";
import { checkRateLimiterReadiness } from "@/server/services/rate-limit/check-rate-limiter-readiness";
import { getRedisClient, type RedisWithRateLimitCommands } from "@/server/services/rate-limit/redis-client";
import { RedisRateLimiter } from "@/server/services/rate-limit/redis-rate-limiter";

/**
 * Phase 10A §31 - real network round-trip tests against an actually-running
 * Redis server (this repo's local dev Redis instance via `redis-server.exe
 * --port 6390`), never a mock/fake client. Skipped entirely (not failed)
 * unless TEST_REDIS_URL is set - the default `pnpm test` run does not
 * require live Redis. To run for real:
 *
 *   TEST_REDIS_URL=redis://localhost:6390 \
 *   pnpm exec dotenv -e .env.test -- vitest run tests/integration/redis-rate-limit-real.test.ts
 */
const testRedisUrl = process.env.TEST_REDIS_URL;
const hasRedisConfig = Boolean(testRedisUrl);

describe.skipIf(!hasRedisConfig)("RedisRateLimiter against real Redis (§31)", () => {
  // Deliberately built in beforeAll (not at describe-body top level) - a
  // skipped suite's describe callback still runs synchronously to collect
  // its tests, so eagerly calling resolveRedisConfig()/getRedisClient()
  // here would throw ("REDIS_URL이 설정되지 않았습니다.") even when this
  // whole suite is meant to be skipped because TEST_REDIS_URL is unset.
  const keyPrefix = `senecial-test-${randomUUID().slice(0, 8)}`;
  let client: RedisWithRateLimitCommands;
  let limiter: RedisRateLimiter;

  beforeAll(() => {
    const config = resolveRedisConfig({
      ...process.env,
      REDIS_URL: testRedisUrl,
      REDIS_KEY_PREFIX: keyPrefix,
    });
    client = getRedisClient(config);
    limiter = new RedisRateLimiter(client);
  });

  afterAll(async () => {
    if (!client) {
      return;
    }
    const keys = await client.keys(`${keyPrefix}:*`);
    if (keys.length > 0) {
      await client.del(...keys.map((k) => k.slice(`${keyPrefix}:`.length)));
    }
  });

  it("allows requests within the limit and reports decreasing remaining", async () => {
    const key = randomUUID();
    const first = await limiter.consume({ key, limit: 5, windowSeconds: 60 });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);

    const second = await limiter.consume({ key, limit: 5, windowSeconds: 60 });
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(3);
  });

  it("blocks once the limit is exceeded, with remaining clamped to 0", async () => {
    const key = randomUUID();
    for (let i = 0; i < 3; i++) {
      await limiter.consume({ key, limit: 3, windowSeconds: 60 });
    }
    const blocked = await limiter.consume({ key, limit: 3, windowSeconds: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("resets after the window elapses (real wall-clock wait)", async () => {
    const key = randomUUID();
    await limiter.consume({ key, limit: 1, windowSeconds: 1 });
    const blocked = await limiter.consume({ key, limit: 1, windowSeconds: 1 });
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const afterReset = await limiter.consume({ key, limit: 1, windowSeconds: 1 });
    expect(afterReset.allowed).toBe(true);
  }, 10_000);

  it("tracks separate keys independently", async () => {
    const keyA = randomUUID();
    const keyB = randomUUID();
    await limiter.consume({ key: keyA, limit: 1, windowSeconds: 60 });
    const blockedA = await limiter.consume({ key: keyA, limit: 1, windowSeconds: 60 });
    const allowedB = await limiter.consume({ key: keyB, limit: 1, windowSeconds: 60 });
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("is atomic under real concurrent access - exactly `limit` of N parallel racing consumes are allowed", async () => {
    const key = randomUUID();
    const limit = 10;
    const concurrentCalls = 25;

    const results = await Promise.all(
      Array.from({ length: concurrentCalls }, () => limiter.consume({ key, limit, windowSeconds: 60 }))
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    // A GET->INCR->EXPIRE race (what the Lua script exists to avoid) could
    // allow MORE than `limit` under real concurrency - this is the test
    // that would catch that regression; a plain unit test with a fake
    // client cannot exercise real network-level concurrency this way.
    expect(allowedCount).toBe(limit);
  });

  it("checkRateLimiterReadiness() reports ok against the real server via a live PING", async () => {
    const originalDriver = process.env.RATE_LIMITER;
    const originalUrl = process.env.REDIS_URL;
    const originalPrefix = process.env.REDIS_KEY_PREFIX;
    process.env.RATE_LIMITER = "redis";
    process.env.REDIS_URL = testRedisUrl;
    process.env.REDIS_KEY_PREFIX = keyPrefix;
    try {
      const status = await checkRateLimiterReadiness();
      expect(status).toBe("ok");
    } finally {
      process.env.RATE_LIMITER = originalDriver;
      process.env.REDIS_URL = originalUrl;
      process.env.REDIS_KEY_PREFIX = originalPrefix;
    }
  });

  it("an unreachable Redis host fails fast rather than hanging (§21 - maxRetriesPerRequest/timeouts)", async () => {
    const unreachable = new Redis("redis://127.0.0.1:1", {
      connectTimeout: 500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    const start = Date.now();
    await expect(unreachable.ping()).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(5000);
    unreachable.disconnect();
  });
});
