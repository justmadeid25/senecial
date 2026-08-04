import { describe, expect, it } from "vitest";

import { EXTRACTION_ERROR_CODES } from "@/domain/extraction/extraction-error-codes";
import { isRetryableExtractionError } from "@/domain/extraction/extraction-error-codes";

describe("isRetryableExtractionError", () => {
  it("allows retry for a transient error code below max attempts", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.FILE_NOT_FOUND, 1, 3)).toBe(true);
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.TEXT_EXTRACTION_FAILED, 0, 3)).toBe(
      true
    );
    expect(
      isRetryableExtractionError(EXTRACTION_ERROR_CODES.FIELD_EXTRACTION_FAILED, 2, 3)
    ).toBe(true);
    expect(
      isRetryableExtractionError(EXTRACTION_ERROR_CODES.INVALID_PROVIDER_RESPONSE, 2, 3)
    ).toBe(true);
  });

  it("refuses retry once attempt reaches maxAttempts, even for a transient code", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.FILE_NOT_FOUND, 3, 3)).toBe(false);
  });

  it("refuses retry once attempt exceeds maxAttempts", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.FILE_NOT_FOUND, 4, 3)).toBe(false);
  });

  it("refuses retry for CHECKSUM_MISMATCH regardless of attempt count", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.CHECKSUM_MISMATCH, 0, 3)).toBe(false);
  });

  it("refuses retry for UNSUPPORTED_FORMAT regardless of attempt count", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.UNSUPPORTED_FORMAT, 0, 3)).toBe(
      false
    );
  });

  it("refuses retry for OCR_REQUIRED regardless of attempt count", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.OCR_REQUIRED, 0, 3)).toBe(false);
  });

  it("refuses retry for MAX_ATTEMPTS_REACHED regardless of attempt count", () => {
    expect(isRetryableExtractionError(EXTRACTION_ERROR_CODES.MAX_ATTEMPTS_REACHED, 0, 3)).toBe(
      false
    );
  });

  it("treats an unrecognized error code as retryable (only known codes are excluded)", () => {
    expect(isRetryableExtractionError("SOME_UNKNOWN_CODE", 0, 3)).toBe(true);
  });
});
