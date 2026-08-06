import {
  CIRCUIT_BREAKER_CONFIG,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitCallToken,
  type CircuitState,
} from "@/domain/ai/circuit-breaker";

import type { RedisWithCircuitBreakerCommands } from "./redis-circuit-breaker-client";

function isCircuitState(value: string): value is CircuitState {
  return value === "CLOSED" || value === "OPEN" || value === "HALF_OPEN";
}

/** Real (not a stub) Redis-backed circuit breaker - see redis-circuit-breaker-lua-scripts.ts for the atomic state-machine logic. */
export class RedisCircuitBreaker implements CircuitBreaker {
  constructor(
    private readonly client: RedisWithCircuitBreakerCommands,
    private readonly config: CircuitBreakerConfig = CIRCUIT_BREAKER_CONFIG
  ) {}

  async beforeCall(key: string): Promise<CircuitCallToken> {
    const [allowed, state] = await this.client.circuitBeforeCall(
      key,
      Date.now(),
      this.config.openDurationSeconds * 1000,
      this.config.probeTimeoutMs
    );
    return { allowed: allowed === 1, state: isCircuitState(state) ? state : "CLOSED" };
  }

  async onSuccess(key: string): Promise<void> {
    await this.client.circuitOnSuccess(key);
  }

  async onFailure(key: string): Promise<void> {
    await this.client.circuitOnFailure(
      key,
      Date.now(),
      this.config.failureThreshold,
      this.config.failureWindowSeconds,
      this.config.openDurationSeconds
    );
  }

  /**
   * Read-only - deliberately does NOT call beforeCall() (which would
   * consume the single HALF_OPEN probe slot as a side effect of a mere
   * diagnostic read). Derives the same state a beforeCall() would report,
   * from a plain HGETALL.
   */
  async getState(key: string): Promise<CircuitState> {
    const raw = await this.client.hgetall(key);
    if (!raw.openedAt) {
      return "CLOSED";
    }
    const elapsed = Date.now() - Number(raw.openedAt);
    return elapsed < this.config.openDurationSeconds * 1000 ? "OPEN" : "HALF_OPEN";
  }
}
