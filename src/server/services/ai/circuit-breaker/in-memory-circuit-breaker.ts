import { CIRCUIT_BREAKER_CONFIG, type CircuitBreaker, type CircuitBreakerConfig, type CircuitCallToken, type CircuitState } from "@/domain/ai/circuit-breaker";

interface BreakerEntry {
  failures: number;
  failureWindowStartedAt?: number;
  openedAt?: number;
  halfOpenProbeAt?: number;
}

/**
 * Process-local only (see get-ai-circuit-breaker.ts's production guard,
 * same pattern as InMemoryConcurrencyLimiter/InMemoryRateLimiter) - state
 * machine logic mirrors redis-circuit-breaker-lua-scripts.ts exactly, just
 * without the atomicity concern (single JS thread, no concurrent writers).
 */
export class InMemoryCircuitBreaker implements CircuitBreaker {
  private readonly entries = new Map<string, BreakerEntry>();

  constructor(private readonly config: CircuitBreakerConfig = CIRCUIT_BREAKER_CONFIG) {}

  private getEntry(key: string): BreakerEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { failures: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  async beforeCall(key: string): Promise<CircuitCallToken> {
    const entry = this.getEntry(key);
    const now = Date.now();

    if (entry.openedAt === undefined) {
      return { allowed: true, state: "CLOSED" };
    }

    const elapsed = now - entry.openedAt;
    if (elapsed < this.config.openDurationSeconds * 1000) {
      return { allowed: false, state: "OPEN" };
    }

    if (entry.halfOpenProbeAt !== undefined && now - entry.halfOpenProbeAt < this.config.probeTimeoutMs) {
      return { allowed: false, state: "HALF_OPEN" };
    }

    entry.halfOpenProbeAt = now;
    return { allowed: true, state: "HALF_OPEN" };
  }

  async onSuccess(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async onFailure(key: string): Promise<void> {
    const entry = this.getEntry(key);
    const now = Date.now();

    if (entry.openedAt !== undefined) {
      entry.openedAt = now;
      entry.halfOpenProbeAt = undefined;
      return;
    }

    if (entry.failureWindowStartedAt === undefined || now - entry.failureWindowStartedAt > this.config.failureWindowSeconds * 1000) {
      entry.failureWindowStartedAt = now;
      entry.failures = 0;
    }
    entry.failures += 1;

    if (entry.failures >= this.config.failureThreshold) {
      entry.openedAt = now;
    }
  }

  async getState(key: string): Promise<CircuitState> {
    const entry = this.entries.get(key);
    if (!entry || entry.openedAt === undefined) {
      return "CLOSED";
    }
    const elapsed = Date.now() - entry.openedAt;
    return elapsed < this.config.openDurationSeconds * 1000 ? "OPEN" : "HALF_OPEN";
  }
}
