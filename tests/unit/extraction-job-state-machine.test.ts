import { describe, expect, it } from "vitest";

import { ExtractionJobStatus } from "@/generated/prisma/enums";
import { canTransitionExtractionJobStatus } from "@/domain/extraction/job-state-machine";

describe("canTransitionExtractionJobStatus - allowed transitions", () => {
  it("allows PENDING -> PROCESSING", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PENDING, ExtractionJobStatus.PROCESSING)
    ).toBe(true);
  });

  it("allows PENDING -> CANCELLED", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PENDING, ExtractionJobStatus.CANCELLED)
    ).toBe(true);
  });

  it("allows PROCESSING -> REVIEW_REQUIRED", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.PROCESSING,
        ExtractionJobStatus.REVIEW_REQUIRED
      )
    ).toBe(true);
  });

  it("allows PROCESSING -> FAILED", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PROCESSING, ExtractionJobStatus.FAILED)
    ).toBe(true);
  });

  it("allows REVIEW_REQUIRED -> COMPLETED (apply)", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.REVIEW_REQUIRED,
        ExtractionJobStatus.COMPLETED
      )
    ).toBe(true);
  });

  it("allows REVIEW_REQUIRED -> PROCESSING (re-extraction reuses the same row)", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.REVIEW_REQUIRED,
        ExtractionJobStatus.PROCESSING
      )
    ).toBe(true);
  });

  it("allows FAILED -> PENDING (retry reuses the same row)", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.FAILED, ExtractionJobStatus.PENDING)
    ).toBe(true);
  });

  it("allows FAILED -> CANCELLED", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.FAILED, ExtractionJobStatus.CANCELLED)
    ).toBe(true);
  });
});

describe("canTransitionExtractionJobStatus - forbidden transitions", () => {
  it("forbids PENDING -> REVIEW_REQUIRED (skipping PROCESSING)", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.PENDING,
        ExtractionJobStatus.REVIEW_REQUIRED
      )
    ).toBe(false);
  });

  it("forbids PENDING -> COMPLETED", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PENDING, ExtractionJobStatus.COMPLETED)
    ).toBe(false);
  });

  it("forbids PROCESSING -> PENDING (no going backwards without going through FAILED)", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PROCESSING, ExtractionJobStatus.PENDING)
    ).toBe(false);
  });

  it("forbids PROCESSING -> COMPLETED (must pass through REVIEW_REQUIRED)", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.PROCESSING,
        ExtractionJobStatus.COMPLETED
      )
    ).toBe(false);
  });

  it("forbids REVIEW_REQUIRED -> FAILED", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.REVIEW_REQUIRED, ExtractionJobStatus.FAILED)
    ).toBe(false);
  });

  it("forbids FAILED -> REVIEW_REQUIRED", () => {
    expect(
      canTransitionExtractionJobStatus(
        ExtractionJobStatus.FAILED,
        ExtractionJobStatus.REVIEW_REQUIRED
      )
    ).toBe(false);
  });

  it("forbids any transition out of COMPLETED (terminal)", () => {
    for (const to of Object.values(ExtractionJobStatus)) {
      expect(canTransitionExtractionJobStatus(ExtractionJobStatus.COMPLETED, to)).toBe(false);
    }
  });

  it("forbids any transition out of CANCELLED (terminal)", () => {
    for (const to of Object.values(ExtractionJobStatus)) {
      expect(canTransitionExtractionJobStatus(ExtractionJobStatus.CANCELLED, to)).toBe(false);
    }
  });

  it("forbids a same-status no-op transition unless explicitly allowed", () => {
    expect(
      canTransitionExtractionJobStatus(ExtractionJobStatus.PENDING, ExtractionJobStatus.PENDING)
    ).toBe(false);
  });
});
