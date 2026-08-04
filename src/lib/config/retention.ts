const DEFAULT_SOFT_DELETED_CONTRACT_DAYS = 30;
const DEFAULT_AUDIT_LOG_DAYS = 365;
const DEFAULT_INVITATION_DAYS = 90;
const DEFAULT_NOTIFICATION_DAYS = 365;
const DEFAULT_FAILED_JOB_DAYS = 90;
const DEFAULT_PURGE_BATCH_SIZE = 100;

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

/**
 * Single source of truth for retention windows (Phase 9 §4). Every value is
 * a number of days measured from the relevant timestamp (see README's data
 * classification table for exactly which timestamp each one uses) and is
 * read once at module load, mirroring the config/extraction.ts pattern.
 */
export const RETENTION_SOFT_DELETED_CONTRACT_DAYS = parsePositiveInt(
  process.env.RETENTION_SOFT_DELETED_CONTRACT_DAYS,
  DEFAULT_SOFT_DELETED_CONTRACT_DAYS,
  "RETENTION_SOFT_DELETED_CONTRACT_DAYS"
);

/** AuditLog rows never contain contract/clause text, so this is safe to keep well past a purged contract's own lifetime. */
export const RETENTION_AUDIT_LOG_DAYS = parsePositiveInt(
  process.env.RETENTION_AUDIT_LOG_DAYS,
  DEFAULT_AUDIT_LOG_DAYS,
  "RETENTION_AUDIT_LOG_DAYS"
);

/** Measured from the invitation's terminal state (acceptedAt/revokedAt/expiresAt), not createdAt. */
export const RETENTION_INVITATION_DAYS = parsePositiveInt(
  process.env.RETENTION_INVITATION_DAYS,
  DEFAULT_INVITATION_DAYS,
  "RETENTION_INVITATION_DAYS"
);

export const RETENTION_NOTIFICATION_DAYS = parsePositiveInt(
  process.env.RETENTION_NOTIFICATION_DAYS,
  DEFAULT_NOTIFICATION_DAYS,
  "RETENTION_NOTIFICATION_DAYS"
);

/** Permanently FAILED (maxAttempts reached) extraction/segmentation jobs - purged for storage hygiene, not for privacy reasons. */
export const RETENTION_FAILED_JOB_DAYS = parsePositiveInt(
  process.env.RETENTION_FAILED_JOB_DAYS,
  DEFAULT_FAILED_JOB_DAYS,
  "RETENTION_FAILED_JOB_DAYS"
);

/** Max number of DataPurgeJob rows scanned/processed per retention:scan or retention:purge invocation. */
export const RETENTION_PURGE_BATCH_SIZE = parsePositiveInt(
  process.env.RETENTION_PURGE_BATCH_SIZE,
  DEFAULT_PURGE_BATCH_SIZE,
  "RETENTION_PURGE_BATCH_SIZE"
);
