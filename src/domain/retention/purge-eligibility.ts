/**
 * Pure date-arithmetic helpers for retention/purge eligibility (Phase 9
 * §4). Kept free of any Prisma/IO so they can be unit tested directly -
 * mirrors domain/analytics/date-buckets.ts's separation of "pure
 * calculation" from "repository query".
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The instant a resource whose lifecycle timestamp is `since` becomes purge-eligible under a `retentionDays`-day window. */
export function purgeEligibleAt(since: Date, retentionDays: number): Date {
  return new Date(since.getTime() + retentionDays * MS_PER_DAY);
}

/** Whether `since` + `retentionDays` has already elapsed as of `now`. */
export function isPastRetention(since: Date, retentionDays: number, now: Date): boolean {
  return purgeEligibleAt(since, retentionDays).getTime() <= now.getTime();
}

/** The cutoff timestamp: rows whose lifecycle timestamp is <= this value are purge-eligible. Convenience for building a Prisma `{ lte: cutoff }` filter directly. */
export function retentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}
