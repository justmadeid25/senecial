import { resolveRedisConfig } from "@/lib/config/redis";

import type { CacheProvider } from "./cache-provider";
import type { DistributedLock } from "./distributed-lock";
import { RedisDistributedLock } from "./distributed-lock";
import { InMemoryCacheProvider } from "./in-memory-cache-provider";
import { getAiCacheRedisClient } from "./redis-client";
import { RedisCacheProvider } from "./redis-cache-provider";

let cachedProvider: CacheProvider | undefined;

/**
 * §Cache (Phase 12 Part N) - `AI_CACHE_PROVIDER=memory` (the default) is
 * process-local only and is refused in production unless
 * ALLOW_IN_MEMORY_AI_CACHE=true is also set - identical guard pattern to
 * getRateLimiter()/getEmbeddingProvider()/getLlmProvider(). A cache is
 * only ever a performance optimization (every call site treats a miss as
 * the normal, always-correct path - see hybrid-search-clauses.ts's own
 * comment), so unlike those other guards this one is about consistent
 * multi-instance behavior/cost, never correctness: a stale in-memory-only
 * cache on one instance simply means that instance alone repeats work the
 * others already cached.
 */
export function getCacheProvider(): CacheProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_CACHE_PROVIDER ?? "memory";

  switch (driver) {
    case "memory": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_IN_MEMORY_AI_CACHE !== "true") {
        throw new Error(
          "AI_CACHE_PROVIDER=memory는 운영 환경에서 여러 인스턴스에 걸쳐 공유되지 않습니다. 실제 공유 캐시(Redis)를 " +
            "연동하거나, 위험을 감수하고 명시적으로 ALLOW_IN_MEMORY_AI_CACHE=true를 설정하십시오."
        );
      }
      cachedProvider = new InMemoryCacheProvider();
      return cachedProvider;
    }
    case "redis": {
      const config = resolveRedisConfig();
      const client = getAiCacheRedisClient(config);
      cachedProvider = new RedisCacheProvider(client);
      return cachedProvider;
    }
    default:
      throw new Error(`지원하지 않는 AI_CACHE_PROVIDER 입니다: ${driver}`);
  }
}

/**
 * §Phase 12.2 Part F (§35) - `undefined` when AI_CACHE_PROVIDER=memory (a
 * single process has no other instance to coordinate with - in-process
 * single-flight, see in-flight-deduplication.ts, is already sufficient).
 * Only meaningful/non-undefined for `redis`, where multiple server
 * instances share one Redis and can genuinely race on the same key.
 */
export function getCacheStampedeLock(): DistributedLock | undefined {
  const driver = process.env.AI_CACHE_PROVIDER ?? "memory";
  if (driver !== "redis") {
    return undefined;
  }
  const config = resolveRedisConfig();
  const client = getAiCacheRedisClient(config);
  return new RedisDistributedLock(client);
}
