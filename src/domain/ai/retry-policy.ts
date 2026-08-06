/**
 * §Phase 13 Part E (§16) - "500ms / 1500ms / 4000ms" backoff, achieved with
 * a base delay tripled per attempt and capped at maxDelayMs (500*3^0=500,
 * 500*3^1=1500, 500*3^2=4500 -> capped to 4000). `maxRetries=2` means at
 * most 3 total attempts (the original + 2 retries) - matches Part E's own
 * example.
 */
export interface RetryPolicyConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

/**
 * Full jitter in [0.5x, 1.0x] of the exponential delay - never zero (a
 * thundering-herd retry storm hitting an already-struggling provider at
 * the exact same instant is exactly what jitter exists to prevent) and
 * never unbounded above the exponential value itself. `randomFn` is
 * injectable so unit tests can assert exact bounds without flakiness from
 * real randomness.
 */
export function computeBackoffMs(
  attemptIndex: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
  randomFn: () => number = Math.random
): number {
  const exponential = Math.min(config.baseDelayMs * Math.pow(3, attemptIndex), config.maxDelayMs);
  const jitterFactor = 0.5 + randomFn() * 0.5;
  return Math.floor(exponential * jitterFactor);
}
