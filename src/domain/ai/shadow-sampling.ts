/**
 * §Phase 13 Part F (§20) - per-request sampling decision for shadow mode.
 * Unlike canary assignment (stable per-organization), shadow sampling is
 * deliberately a fresh per-request coin flip - shadow calls are for
 * aggregate quality/latency comparison, not a per-organization rollout
 * decision, so there is no need (and no benefit) for stability across
 * requests. `randomFn` is injectable for deterministic unit tests.
 */
export function shouldSampleForShadow(sampleRate: number, randomFn: () => number = Math.random): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return randomFn() < sampleRate;
}
