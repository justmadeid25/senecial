const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_BATCH_SIZE = 10;

function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

/** How many times a failed segmentation job may be retried before it is permanently FAILED. */
export const CLAUSE_SEGMENTATION_MAX_ATTEMPTS = parsePositiveInt(
  process.env.CLAUSE_SEGMENTATION_MAX_ATTEMPTS,
  DEFAULT_MAX_ATTEMPTS,
  "CLAUSE_SEGMENTATION_MAX_ATTEMPTS"
);

/** A PROCESSING job whose lock is older than this is presumed to have lost its worker - see recover-stale-clause-jobs.ts. */
export const CLAUSE_SEGMENTATION_STALE_MINUTES = parsePositiveInt(
  process.env.CLAUSE_SEGMENTATION_STALE_MINUTES,
  DEFAULT_STALE_MINUTES,
  "CLAUSE_SEGMENTATION_STALE_MINUTES"
);

/** Default job count scripts/process-clause-segmentation-jobs.ts claims per invocation when neither --once nor --limit is passed. */
export const CLAUSE_SEGMENTATION_BATCH_SIZE = parsePositiveInt(
  process.env.CLAUSE_SEGMENTATION_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  "CLAUSE_SEGMENTATION_BATCH_SIZE"
);
