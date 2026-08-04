export const EXTRACTION_ERROR_CODES = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  OCR_REQUIRED: "OCR_REQUIRED",
  TEXT_EXTRACTION_FAILED: "TEXT_EXTRACTION_FAILED",
  FIELD_EXTRACTION_FAILED: "FIELD_EXTRACTION_FAILED",
  INVALID_PROVIDER_RESPONSE: "INVALID_PROVIDER_RESPONSE",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
} as const;

export type ExtractionErrorCode =
  (typeof EXTRACTION_ERROR_CODES)[keyof typeof EXTRACTION_ERROR_CODES];

/**
 * Errors that mean "trying again with the same input will not help" -
 * everything else (transient I/O, a provider hiccup, a parser glitch) is
 * assumed retryable up to maxAttempts.
 */
const NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  EXTRACTION_ERROR_CODES.CHECKSUM_MISMATCH,
  EXTRACTION_ERROR_CODES.UNSUPPORTED_FORMAT,
  EXTRACTION_ERROR_CODES.OCR_REQUIRED,
  EXTRACTION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
]);

export function isRetryableExtractionError(
  errorCode: string,
  attempt: number,
  maxAttempts: number
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  return !NON_RETRYABLE_ERROR_CODES.has(errorCode);
}
