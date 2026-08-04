export const DEFAULT_CLAUSE_SEGMENTATION_STALE_MINUTES = 15;

/** Same shape as domain/extraction/stale-job-policy.ts. */
export function isClauseSegmentationJobStale(
  lockedAt: Date | null,
  now: Date,
  staleMinutes: number = DEFAULT_CLAUSE_SEGMENTATION_STALE_MINUTES
): boolean {
  if (!lockedAt) {
    return false;
  }
  const staleMs = staleMinutes * 60 * 1000;
  return now.getTime() - lockedAt.getTime() >= staleMs;
}
