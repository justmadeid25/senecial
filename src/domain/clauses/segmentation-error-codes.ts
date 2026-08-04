export const SEGMENTATION_ERROR_CODES = {
  EXTRACTED_DOCUMENT_NOT_FOUND: "EXTRACTED_DOCUMENT_NOT_FOUND",
  DOCUMENT_CHECKSUM_MISMATCH: "DOCUMENT_CHECKSUM_MISMATCH",
  SEGMENTATION_FAILED: "SEGMENTATION_FAILED",
  INVALID_SEGMENTATION_RESULT: "INVALID_SEGMENTATION_RESULT",
  INVALID_OFFSETS: "INVALID_OFFSETS",
  INVALID_HIERARCHY: "INVALID_HIERARCHY",
  CLASSIFICATION_FAILED: "CLASSIFICATION_FAILED",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
} as const;

export type SegmentationErrorCode =
  (typeof SEGMENTATION_ERROR_CODES)[keyof typeof SEGMENTATION_ERROR_CODES];

/**
 * Same policy shape as domain/extraction/extraction-error-codes.ts:
 * "trying again with the same input will not help" errors are excluded
 * from retry, everything else (transient I/O, a parser glitch) is assumed
 * retryable up to maxAttempts.
 */
const NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  SEGMENTATION_ERROR_CODES.DOCUMENT_CHECKSUM_MISMATCH,
  SEGMENTATION_ERROR_CODES.INVALID_SEGMENTATION_RESULT,
  SEGMENTATION_ERROR_CODES.INVALID_OFFSETS,
  SEGMENTATION_ERROR_CODES.INVALID_HIERARCHY,
  SEGMENTATION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
]);

export function isRetryableSegmentationError(
  errorCode: string,
  attempt: number,
  maxAttempts: number
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  return !NON_RETRYABLE_ERROR_CODES.has(errorCode);
}
