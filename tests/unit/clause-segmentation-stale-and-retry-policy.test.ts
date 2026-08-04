import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLAUSE_SEGMENTATION_STALE_MINUTES,
  isClauseSegmentationJobStale,
} from "@/domain/clauses/stale-job-policy";
import {
  isRetryableSegmentationError,
  SEGMENTATION_ERROR_CODES,
} from "@/domain/clauses/segmentation-error-codes";

describe("isClauseSegmentationJobStale", () => {
  it("returns false when lockedAt is null", () => {
    expect(isClauseSegmentationJobStale(null, new Date())).toBe(false);
  });

  it("returns false when the lock is younger than the stale threshold", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    const lockedAt = new Date("2026-01-01T00:05:00.000Z");
    expect(isClauseSegmentationJobStale(lockedAt, now, 15)).toBe(false);
  });

  it("returns true once the lock age reaches the stale threshold", () => {
    const now = new Date("2026-01-01T00:15:00.000Z");
    const lockedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isClauseSegmentationJobStale(lockedAt, now, 15)).toBe(true);
  });

  it("uses DEFAULT_CLAUSE_SEGMENTATION_STALE_MINUTES when omitted", () => {
    const now = new Date();
    const justUnder = new Date(
      now.getTime() - (DEFAULT_CLAUSE_SEGMENTATION_STALE_MINUTES * 60 * 1000 - 1000)
    );
    expect(isClauseSegmentationJobStale(justUnder, now)).toBe(false);
  });
});

describe("isRetryableSegmentationError", () => {
  it("allows retry for a transient error below max attempts", () => {
    expect(
      isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.SEGMENTATION_FAILED, 0, 3)
    ).toBe(true);
    expect(
      isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.EXTRACTED_DOCUMENT_NOT_FOUND, 1, 3)
    ).toBe(true);
  });

  it("refuses retry once attempt reaches maxAttempts", () => {
    expect(isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.SEGMENTATION_FAILED, 3, 3)).toBe(
      false
    );
  });

  it("refuses retry for DOCUMENT_CHECKSUM_MISMATCH regardless of attempt count", () => {
    expect(
      isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.DOCUMENT_CHECKSUM_MISMATCH, 0, 3)
    ).toBe(false);
  });

  it("refuses retry for INVALID_OFFSETS regardless of attempt count", () => {
    expect(isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.INVALID_OFFSETS, 0, 3)).toBe(
      false
    );
  });

  it("refuses retry for INVALID_HIERARCHY regardless of attempt count", () => {
    expect(isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.INVALID_HIERARCHY, 0, 3)).toBe(
      false
    );
  });

  it("refuses retry for MAX_ATTEMPTS_REACHED regardless of attempt count", () => {
    expect(
      isRetryableSegmentationError(SEGMENTATION_ERROR_CODES.MAX_ATTEMPTS_REACHED, 0, 3)
    ).toBe(false);
  });
});
