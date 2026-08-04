const DEFAULT_MAX_UPLOAD_SIZE_MB = 20;

/** Exported for direct unit testing - the module-level constant below is just this applied once, at import time, to process.env. */
export function parseMaxUploadSizeMb(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `MAX_UPLOAD_SIZE_MB="${raw}" is not a valid positive number - falling back to the default of ${DEFAULT_MAX_UPLOAD_SIZE_MB}MB.`
    );
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }

  return parsed;
}

/**
 * Single source of truth for the contract-file upload size cap, read once
 * at module load. Every layer that needs this number - domain validation
 * (file-policy.ts), the upload UI's helper text, and next.config.ts's
 * Server Action body-size backstop - imports from here so they cannot
 * silently drift out of sync the way file-policy.ts's old hardcoded 20MB
 * and next.config.ts's old hardcoded 25MB did before this module existed.
 *
 * This file is intentionally free of any Next.js/Prisma import so
 * next.config.ts (which runs in a plain Node context, outside the app's
 * module graph) can import it via a relative path.
 */
export const MAX_UPLOAD_SIZE_MB = parseMaxUploadSizeMb(process.env.MAX_UPLOAD_SIZE_MB);

export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

/**
 * Next.js rejects a Server Action request outright (with its own generic
 * error) once the body exceeds this limit, before our code ever runs. Set
 * a bit above the real cap so a normal-but-oversized upload instead
 * reaches our own validation and gets a clean Korean error message - this
 * is a framework-level backstop, not the primary enforcement point.
 */
export const SERVER_ACTION_BODY_SIZE_LIMIT_MB = Math.ceil(MAX_UPLOAD_SIZE_MB * 1.25);
