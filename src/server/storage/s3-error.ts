interface S3LikeError {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

function asS3LikeError(error: unknown): S3LikeError | null {
  return error && typeof error === "object" ? (error as S3LikeError) : null;
}

/** NoSuchKey (real AWS S3) / NotFound (some S3-compatible providers, incl. MinIO for HeadObject) / a raw 404. */
export function isS3NotFoundError(error: unknown): boolean {
  const s3Error = asS3LikeError(error);
  if (!s3Error) {
    return false;
  }
  return s3Error.name === "NoSuchKey" || s3Error.name === "NotFound" || s3Error.$metadata?.httpStatusCode === 404;
}

const MAX_SAFE_ERROR_LENGTH = 200;

/**
 * §13/§28/§29 - converts any S3 SDK error into a short, safe string: the
 * error's `.name` (a stable classification like "AccessDenied",
 * "NoSuchBucket", "CredentialsProviderError") plus HTTP status if present -
 * never `.message`, which for S3 SDK errors can embed the endpoint URL,
 * bucket name, or details about which step of the credential provider
 * chain was being tried. Every public method on S3CompatibleStorageDriver
 * wraps thrown errors through this before rethrowing, so callers written
 * against the local driver's plain `Error` shape (e.g.
 * reconciliation's `toSafeStorageDeleteError()`, which just reads
 * `error.message`) stay safe automatically without needing to know
 * anything about S3.
 */
export function toSafeS3Error(error: unknown): string {
  const s3Error = asS3LikeError(error);
  const name = s3Error?.name || (error instanceof Error ? error.name : "UnknownError");
  const status = s3Error?.$metadata?.httpStatusCode;
  const message = status ? `${name} (HTTP ${status})` : name;
  return message.length > MAX_SAFE_ERROR_LENGTH ? `${message.slice(0, MAX_SAFE_ERROR_LENGTH)}...` : message;
}

export function toSafeS3Wrapped(error: unknown): Error {
  return new Error(toSafeS3Error(error));
}
