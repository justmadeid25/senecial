import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import { resolveRedisConfig } from "@/lib/config/redis";

import { getAiCircuitBreakerRedisClient } from "./redis-circuit-breaker-client";
import { RedisCircuitBreaker } from "./redis-circuit-breaker";
import { InMemoryCircuitBreaker } from "./in-memory-circuit-breaker";

let cachedBreaker: CircuitBreaker | undefined;

/**
 * §Phase 13 Part E (§17) - "Redis 기반 분산 상태를 우선 검토하십시오. In-memory
 * circuit breaker는 development fallback만 허용할 수 있습니다." Reuses the
 * existing `RATE_LIMITER` env var (memory|redis) rather than a bespoke knob,
 * matching getAiConcurrencyLimiter()'s identical rationale - a circuit
 * breaker is only meaningful when shared across every app instance calling
 * the same provider, exactly the same "do we have a shared coordination
 * store" question the rate limiter already answers.
 */
export function getAiCircuitBreaker(): CircuitBreaker {
  if (cachedBreaker) {
    return cachedBreaker;
  }

  const driver = process.env.RATE_LIMITER ?? "memory";

  switch (driver) {
    case "memory": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_IN_MEMORY_RATE_LIMITER !== "true") {
        throw new Error(
          "RATE_LIMITER=memory(AI circuit breaker 포함)는 운영 환경에서 여러 인스턴스에 걸쳐 정확히 동작하지 않습니다. " +
            "실제 공유 저장소 기반 rate limiter를 연동하거나, 위험을 감수하고 명시적으로 " +
            "ALLOW_IN_MEMORY_RATE_LIMITER=true를 설정하십시오."
        );
      }
      cachedBreaker = new InMemoryCircuitBreaker();
      return cachedBreaker;
    }
    case "redis": {
      const config = resolveRedisConfig();
      const client = getAiCircuitBreakerRedisClient(config);
      cachedBreaker = new RedisCircuitBreaker(client);
      return cachedBreaker;
    }
    default:
      throw new Error(`지원하지 않는 RATE_LIMITER 입니다: ${driver}`);
  }
}
