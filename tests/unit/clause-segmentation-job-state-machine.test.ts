import { describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";
import { canTransitionClauseSegmentationJobStatus } from "@/domain/clauses/job-state-machine";

describe("canTransitionClauseSegmentationJobStatus - allowed transitions", () => {
  it("allows PENDING -> PROCESSING", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.PENDING,
        ClauseSegmentationJobStatus.PROCESSING
      )
    ).toBe(true);
  });

  it("allows PROCESSING -> REVIEW_REQUIRED", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.PROCESSING,
        ClauseSegmentationJobStatus.REVIEW_REQUIRED
      )
    ).toBe(true);
  });

  it("allows PROCESSING -> FAILED", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.PROCESSING,
        ClauseSegmentationJobStatus.FAILED
      )
    ).toBe(true);
  });

  it("allows REVIEW_REQUIRED -> COMPLETED", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.REVIEW_REQUIRED,
        ClauseSegmentationJobStatus.COMPLETED
      )
    ).toBe(true);
  });

  it("allows FAILED -> PENDING (retry reuses the same row)", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.FAILED,
        ClauseSegmentationJobStatus.PENDING
      )
    ).toBe(true);
  });
});

describe("canTransitionClauseSegmentationJobStatus - forbidden transitions", () => {
  it("forbids PENDING -> REVIEW_REQUIRED (skipping PROCESSING)", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.PENDING,
        ClauseSegmentationJobStatus.REVIEW_REQUIRED
      )
    ).toBe(false);
  });

  it("forbids PROCESSING -> PENDING", () => {
    expect(
      canTransitionClauseSegmentationJobStatus(
        ClauseSegmentationJobStatus.PROCESSING,
        ClauseSegmentationJobStatus.PENDING
      )
    ).toBe(false);
  });

  it("forbids any transition out of COMPLETED (terminal)", () => {
    for (const to of Object.values(ClauseSegmentationJobStatus)) {
      expect(canTransitionClauseSegmentationJobStatus(ClauseSegmentationJobStatus.COMPLETED, to)).toBe(
        false
      );
    }
  });

  it("forbids any transition out of CANCELLED (terminal)", () => {
    for (const to of Object.values(ClauseSegmentationJobStatus)) {
      expect(canTransitionClauseSegmentationJobStatus(ClauseSegmentationJobStatus.CANCELLED, to)).toBe(
        false
      );
    }
  });
});
