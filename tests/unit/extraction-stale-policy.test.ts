import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTRACTION_STALE_MINUTES,
  isExtractionJobStale,
} from "@/domain/extraction/stale-job-policy";

describe("isExtractionJobStale", () => {
  it("returns false when lockedAt is null (job never claimed)", () => {
    expect(isExtractionJobStale(null, new Date())).toBe(false);
  });

  it("returns false when the lock is younger than the stale threshold", () => {
    const now = new Date("2026-01-01T00:20:00.000Z");
    const lockedAt = new Date("2026-01-01T00:10:00.000Z");
    expect(isExtractionJobStale(lockedAt, now, 15)).toBe(false);
  });

  it("returns true once the lock age reaches the stale threshold exactly", () => {
    const now = new Date("2026-01-01T00:15:00.000Z");
    const lockedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isExtractionJobStale(lockedAt, now, 15)).toBe(true);
  });

  it("returns true when the lock age exceeds the stale threshold", () => {
    const now = new Date("2026-01-01T01:00:00.000Z");
    const lockedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(isExtractionJobStale(lockedAt, now, 15)).toBe(true);
  });

  it("uses DEFAULT_EXTRACTION_STALE_MINUTES when staleMinutes is omitted", () => {
    const now = new Date();
    const justUnderDefault = new Date(
      now.getTime() - (DEFAULT_EXTRACTION_STALE_MINUTES * 60 * 1000 - 1000)
    );
    const overDefault = new Date(
      now.getTime() - (DEFAULT_EXTRACTION_STALE_MINUTES * 60 * 1000 + 1000)
    );
    expect(isExtractionJobStale(justUnderDefault, now)).toBe(false);
    expect(isExtractionJobStale(overDefault, now)).toBe(true);
  });
});
