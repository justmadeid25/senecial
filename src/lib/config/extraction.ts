const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_BATCH_SIZE = 50;

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

/** How many times a failed extraction job may be retried before it is permanently FAILED. */
export const EXTRACTION_MAX_ATTEMPTS = parsePositiveInt(
  process.env.EXTRACTION_MAX_ATTEMPTS,
  DEFAULT_MAX_ATTEMPTS,
  "EXTRACTION_MAX_ATTEMPTS"
);

/** A PROCESSING job whose lock is older than this is presumed to have lost its worker - see recover-stale-extraction-jobs.ts. */
export const EXTRACTION_STALE_MINUTES = parsePositiveInt(
  process.env.EXTRACTION_STALE_MINUTES,
  DEFAULT_STALE_MINUTES,
  "EXTRACTION_STALE_MINUTES"
);

/** Default job count scripts/process-extraction-jobs.ts claims per invocation when neither --once nor --limit is passed. */
export const EXTRACTION_BATCH_SIZE = parsePositiveInt(
  process.env.EXTRACTION_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  "EXTRACTION_BATCH_SIZE"
);
