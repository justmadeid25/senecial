import { createHash } from "node:crypto";

/**
 * §Phase 13 Part F (§21) - stable hash-based canary bucket assignment.
 * "동일 조직은 rollout 기간 동안 같은 provider를 사용해야 비교가
 * 일관됩니다" - never a per-request random draw (which would let the
 * SAME organization bounce between providers across requests, making any
 * quality/cost comparison meaningless). SHA-256 of the organizationId
 * alone (no salt/date component) means a given org's bucket NEVER changes
 * as long as its id doesn't - the rollout percentage is the only thing
 * that moves (5% -> 25% -> 50% -> 100%), which monotonically only ADDS
 * organizations to canary, never reshuffles who is already in it.
 */
export function computeCanaryBucket(organizationId: string): number {
  const hash = createHash("sha256").update(organizationId).digest();
  return hash.readUInt32BE(0) % 100;
}

/**
 * `percentageInCanary` is 0-100. An organization is in canary iff its
 * stable bucket (0-99) falls below the current rollout percentage - so
 * raising the percentage from 25 to 50 keeps every org that was already
 * in canary at 25% still in canary at 50% (their bucket didn't change),
 * and only adds orgs whose bucket is in [25, 50).
 */
export function isOrganizationInCanary(organizationId: string, percentageInCanary: number): boolean {
  if (percentageInCanary <= 0) return false;
  if (percentageInCanary >= 100) return true;
  return computeCanaryBucket(organizationId) < percentageInCanary;
}
