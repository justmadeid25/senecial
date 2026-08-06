/**
 * §Phase 13 Part E (§17) - per-provider circuit breaker, distinct from
 * ConcurrencyLimiter (a semaphore bounding IN-FLIGHT requests) and
 * RateLimiter (a throughput window): this tracks provider HEALTH across
 * calls and, once a provider is clearly failing, stops sending it new
 * requests for a cooldown period rather than letting every caller
 * individually time out against a provider that is already down.
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitCallToken {
  /** false means the circuit is OPEN - the caller must NOT attempt the call (fail fast, no network round trip). */
  allowed: boolean;
  state: CircuitState;
}

export interface CircuitBreaker {
  /** Never blocks/waits. In HALF_OPEN, allows exactly one probe call at a time. */
  beforeCall(key: string): Promise<CircuitCallToken>;
  /** Resets the breaker to CLOSED (a success during HALF_OPEN closes the circuit; during CLOSED it's a cheap no-op reset). */
  onSuccess(key: string): Promise<void>;
  /** A failure while OPEN/HALF_OPEN immediately re-opens (extends the cooldown); a failure while CLOSED counts toward the threshold. */
  onFailure(key: string): Promise<void>;
  /** Read-only - for diagnostics/metrics, never for gating a call (use beforeCall for that). */
  getState(key: string): Promise<CircuitState>;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  failureWindowSeconds: number;
  openDurationSeconds: number;
  probeTimeoutMs: number;
}

/**
 * §17's own example policy: 5 consecutive failures within 60s -> OPEN for
 * 30s -> HALF_OPEN allows 1 probe -> success closes, failure re-opens.
 * `probeTimeoutMs` bounds how long a HALF_OPEN probe may hold the "in
 * flight" slot before it's considered abandoned (e.g. the process that
 * acquired it crashed before calling onSuccess/onFailure) and a fresh
 * probe is allowed again - without this the breaker could wedge itself
 * open forever after a crash mid-probe.
 */
export const CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindowSeconds: 60,
  openDurationSeconds: 30,
  probeTimeoutMs: 30_000,
};
