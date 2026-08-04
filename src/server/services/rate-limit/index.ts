import type { RateLimiter } from "@/domain/rate-limit/rate-limiter";
import { resolveRedisConfig } from "@/lib/config/redis";

import { InMemoryRateLimiter } from "./in-memory-rate-limiter";
import { getRedisClient } from "./redis-client";
import { RedisRateLimiter } from "./redis-rate-limiter";

let cachedLimiter: RateLimiter | undefined;

/**
 * Returns the configured rate limiter. `RATE_LIMITER=memory` (the default)
 * is process-local only and is refused in production unless
 * ALLOW_IN_MEMORY_RATE_LIMITER=true is also set - same guard pattern as
 * getFileMalwareScanner()/getInvitationMailer()/getBackupEncryptor(). A
 * multi-instance production deployment that sets this flag anyway is
 * accepting that each instance enforces its own independent limit (so the
 * effective limit is roughly limit × instance count).
 *
 * `RATE_LIMITER=redis` needs no such flag/override - it IS the real,
 * shared-storage-backed driver the guard above exists to steer production
 * toward, so `production:validate` accepts it unconditionally (Phase 10A's
 * core completion condition).
 */
export function getRateLimiter(): RateLimiter {
  if (cachedLimiter) {
    return cachedLimiter;
  }

  const driver = process.env.RATE_LIMITER ?? "memory";

  switch (driver) {
    case "memory": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_IN_MEMORY_RATE_LIMITER !== "true") {
        throw new Error(
          "RATE_LIMITER=memory는 운영 환경에서 여러 인스턴스에 걸쳐 정확히 동작하지 않습니다. 실제 공유 저장소 기반 " +
            "rate limiter를 연동하거나, 위험을 감수하고 명시적으로 ALLOW_IN_MEMORY_RATE_LIMITER=true를 설정하십시오."
        );
      }
      cachedLimiter = new InMemoryRateLimiter();
      return cachedLimiter;
    }
    case "redis": {
      const config = resolveRedisConfig();
      const client = getRedisClient(config);
      cachedLimiter = new RedisRateLimiter(client);
      return cachedLimiter;
    }
    default:
      throw new Error(`지원하지 않는 RATE_LIMITER 입니다: ${driver}`);
  }
}
