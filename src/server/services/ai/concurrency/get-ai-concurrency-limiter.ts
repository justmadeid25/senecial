import type { ConcurrencyLimiter } from "@/domain/ai/concurrency-limiter";
import { resolveRedisConfig } from "@/lib/config/redis";

import { getAiConcurrencyRedisClient } from "./redis-concurrency-client";
import { RedisConcurrencyLimiter } from "./redis-concurrency-limiter";
import { InMemoryConcurrencyLimiter } from "./in-memory-concurrency-limiter";

let cachedLimiter: ConcurrencyLimiter | undefined;

/**
 * §Phase 12.2 Part E (§33) - deliberately reuses the existing `RATE_LIMITER`
 * env var (memory|redis) rather than introducing a second, parallel config
 * knob for what is fundamentally the same operational decision ("do we
 * have a shared Redis this deployment can coordinate through") - matches
 * §33's own instruction to consider "existing rate limiter 확장" over a
 * bespoke mechanism. Same production guard shape as every other
 * memory-vs-redis driver pair in this codebase (getRateLimiter(),
 * getCacheProvider()): `memory` is refused in production unless
 * ALLOW_IN_MEMORY_RATE_LIMITER=true is ALSO set (reuses that flag too,
 * rather than adding yet another one for the same underlying risk) - §33's
 * own "단순 in-memory semaphore는 production 기본 구현으로 사용하지
 * 마십시오".
 */
export function getAiConcurrencyLimiter(): ConcurrencyLimiter {
  if (cachedLimiter) {
    return cachedLimiter;
  }

  const driver = process.env.RATE_LIMITER ?? "memory";

  switch (driver) {
    case "memory": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_IN_MEMORY_RATE_LIMITER !== "true") {
        throw new Error(
          "RATE_LIMITER=memory(AI concurrency 한도 포함)는 운영 환경에서 여러 인스턴스에 걸쳐 정확히 동작하지 않습니다. " +
            "실제 공유 저장소 기반 rate limiter를 연동하거나, 위험을 감수하고 명시적으로 " +
            "ALLOW_IN_MEMORY_RATE_LIMITER=true를 설정하십시오."
        );
      }
      cachedLimiter = new InMemoryConcurrencyLimiter();
      return cachedLimiter;
    }
    case "redis": {
      const config = resolveRedisConfig();
      const client = getAiConcurrencyRedisClient(config);
      cachedLimiter = new RedisConcurrencyLimiter(client);
      return cachedLimiter;
    }
    default:
      throw new Error(`지원하지 않는 RATE_LIMITER 입니다: ${driver}`);
  }
}
