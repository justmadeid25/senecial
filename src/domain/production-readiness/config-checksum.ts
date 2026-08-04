import { createHash } from "node:crypto";

/**
 * Phase 11 §Config checksum - a fixed allowlist of NON-secret configuration
 * keys (driver/feature-flag selections, not credentials) whose *values*
 * are safe to include verbatim in a checksum input and, if ever needed for
 * debugging, in a log line. Deliberately excludes every secret-bearing var
 * (DATABASE_URL, AUTH_SECRET, REDIS_URL, POSTMARK_SERVER_TOKEN, S3 keys,
 * BACKUP_AGE_IDENTITY, ...) - this checksum answers "did the deployed
 * config's driver/feature selection change between two instances/deploys",
 * never "what is the actual secret value".
 */
const CHECKSUM_KEYS = [
  "NODE_ENV",
  "APP_URL",
  "AUTH_URL",
  "FILE_STORAGE_DRIVER",
  "MAX_UPLOAD_SIZE_MB",
  "INVITATION_MAILER",
  "ALLOW_DEVELOPMENT_INVITATION_MAILER",
  "ACCOUNT_SECURITY_MAILER",
  "ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER",
  "FILE_MALWARE_SCANNER",
  "ALLOW_NOOP_MALWARE_SCANNER",
  "CONTRACT_EXTRACTION_PROVIDER",
  "ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER",
  "CLAUSE_SEGMENTATION_PROVIDER",
  "ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER",
  "BACKUP_ENCRYPTION_PROVIDER",
  "ALLOW_UNENCRYPTED_BACKUP",
  "RATE_LIMITER",
  "ALLOW_IN_MEMORY_RATE_LIMITER",
  "RATE_LIMIT_FAIL_MODE",
  "TRUST_PROXY",
  "TRUSTED_PROXY_HOPS",
  "EMAIL_PROVIDER",
  "EMAIL_VERIFICATION_TOKEN_HOURS",
  "PASSWORD_RESET_TOKEN_HOURS",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_SERVER_SIDE_ENCRYPTION",
  "RETENTION_SOFT_DELETED_CONTRACT_DAYS",
  "RETENTION_AUDIT_LOG_DAYS",
  "RETENTION_INVITATION_DAYS",
  "RETENTION_NOTIFICATION_DAYS",
  "RETENTION_FAILED_JOB_DAYS",
] as const;

export interface ConfigChecksumResult {
  checksum: string;
  keyCount: number;
}

/**
 * Deterministic across process restarts with the same config (sorted key
 * order, `key=value` joined with `\n`) - two instances of the same
 * deployment must produce the identical checksum, and a config drift
 * between them (e.g. one instance still has an old FILE_STORAGE_DRIVER)
 * is visible as a checksum mismatch in their startup logs without ever
 * diffing actual env files against each other.
 */
export function computeConfigChecksum(env: NodeJS.ProcessEnv = process.env): ConfigChecksumResult {
  const pairs = CHECKSUM_KEYS.map((key) => `${key}=${env[key] ?? "(unset)"}`);
  const checksum = createHash("sha256").update(pairs.join("\n")).digest("hex").slice(0, 16);
  return { checksum, keyCount: CHECKSUM_KEYS.length };
}
