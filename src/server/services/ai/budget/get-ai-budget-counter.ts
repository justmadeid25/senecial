import type { BudgetCounter } from "@/domain/ai/budget-counter";
import { resolveRedisConfig } from "@/lib/config/redis";

import { InMemoryBudgetCounter } from "./in-memory-budget-counter";
import { getAiBudgetRedisClient } from "./redis-budget-client";
import { RedisBudgetCounter } from "./redis-budget-counter";

let cachedCounter: BudgetCounter | undefined;

/**
 * §Phase 13 Part G (§27) - "Redis reservation 또는 DB transaction 기반
 * 사용량 예약을 검토하십시오." Reuses the existing `RATE_LIMITER` env var,
 * matching getAiConcurrencyLimiter()/getAiCircuitBreaker()'s identical
 * rationale: budget enforcement is only race-safe when every app instance
 * shares the same counter store.
 */
export function getAiBudgetCounter(): BudgetCounter {
  if (cachedCounter) {
    return cachedCounter;
  }

  const driver = process.env.RATE_LIMITER ?? "memory";

  switch (driver) {
    case "memory": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_IN_MEMORY_RATE_LIMITER !== "true") {
        throw new Error(
          "RATE_LIMITER=memory(AI budget 예약 포함)는 운영 환경에서 여러 인스턴스에 걸쳐 정확히 동작하지 않습니다. " +
            "실제 공유 저장소 기반 rate limiter를 연동하거나, 위험을 감수하고 명시적으로 " +
            "ALLOW_IN_MEMORY_RATE_LIMITER=true를 설정하십시오."
        );
      }
      cachedCounter = new InMemoryBudgetCounter();
      return cachedCounter;
    }
    case "redis": {
      const config = resolveRedisConfig();
      const client = getAiBudgetRedisClient(config);
      cachedCounter = new RedisBudgetCounter(client);
      return cachedCounter;
    }
    default:
      throw new Error(`지원하지 않는 RATE_LIMITER 입니다: ${driver}`);
  }
}
