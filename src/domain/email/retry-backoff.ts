const BASE_BACKOFF_MS_BY_ATTEMPT: Record<number, number> = {
  1: 60 * 1000, // 1 minute
  2: 5 * 60 * 1000, // 5 minutes
  3: 30 * 60 * 1000, // 30 minutes
};
const FALLBACK_BACKOFF_MS = 30 * 60 * 1000;
const JITTER_RATIO = 0.2;

/**
 * Phase 10B section 15 - `attempt` is the attempt number that just failed
 * (1-indexed); the return value is how long to wait before the NEXT
 * attempt becomes eligible (`MailDelivery.scheduledFor`). `random`
 * defaults to `Math.random` but is injectable so tests can assert exact
 * bounds deterministically without stubbing the global.
 *
 * Jitter is uniformly distributed in [-JITTER_RATIO, +JITTER_RATIO] of the
 * base delay - spreads out retries from a burst of failures (e.g. a
 * provider-wide outage affecting many MailDelivery rows at once) instead
 * of every affected row retrying at the exact same instant.
 */
export function computeMailRetryBackoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_BACKOFF_MS_BY_ATTEMPT[attempt] ?? FALLBACK_BACKOFF_MS;
  const jitterFraction = (random() * 2 - 1) * JITTER_RATIO;
  const withJitter = base * (1 + jitterFraction);
  return Math.max(1000, Math.round(withJitter));
}
