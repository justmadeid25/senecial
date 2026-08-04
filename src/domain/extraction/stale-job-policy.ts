export const DEFAULT_EXTRACTION_STALE_MINUTES = 15;

/** True once a PROCESSING job's lock has been held longer than the stale threshold - a worker likely died mid-job. */
export function isExtractionJobStale(
  lockedAt: Date | null,
  now: Date,
  staleMinutes: number = DEFAULT_EXTRACTION_STALE_MINUTES
): boolean {
  if (!lockedAt) {
    return false;
  }
  const staleMs = staleMinutes * 60 * 1000;
  return now.getTime() - lockedAt.getTime() >= staleMs;
}
