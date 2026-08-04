import { describe, expect, it } from "vitest";

import {
  EXPIRATION_BUCKETS,
  expirationBucketForEndDate,
  lastNMonthsKst,
  monthKeyKst,
  monthRangeUtcBounds,
  staleSignalBucketForAge,
  STALE_SIGNAL_BUCKETS,
  subtractMonthsUtc,
} from "@/domain/analytics/date-buckets";

const now = new Date("2026-01-15T12:00:00+09:00"); // KST noon, Jan 15 2026

describe("expirationBucketForEndDate (§9)", () => {
  it("buckets a null endDate as NO_END_DATE", () => {
    expect(expirationBucketForEndDate(null, now)).toBe("NO_END_DATE");
  });

  it("buckets yesterday's KST day as EXPIRED", () => {
    expect(expirationBucketForEndDate(new Date("2026-01-14T00:00:00+09:00"), now)).toBe("EXPIRED");
  });

  it("buckets today's KST day as TODAY", () => {
    expect(expirationBucketForEndDate(new Date("2026-01-15T23:00:00+09:00"), now)).toBe("TODAY");
  });

  it("buckets 1 day remaining as DAYS_1_7, and 7 days remaining as DAYS_1_7", () => {
    expect(expirationBucketForEndDate(new Date("2026-01-16T00:00:00+09:00"), now)).toBe("DAYS_1_7");
    expect(expirationBucketForEndDate(new Date("2026-01-22T00:00:00+09:00"), now)).toBe("DAYS_1_7");
  });

  it("buckets 8 days remaining as DAYS_8_30, and exactly 30 as DAYS_8_30", () => {
    expect(expirationBucketForEndDate(new Date("2026-01-23T00:00:00+09:00"), now)).toBe("DAYS_8_30");
    expect(expirationBucketForEndDate(new Date("2026-02-14T00:00:00+09:00"), now)).toBe("DAYS_8_30");
  });

  it("buckets 31 days remaining as DAYS_31_90, and 90 as DAYS_31_90", () => {
    expect(expirationBucketForEndDate(new Date("2026-02-15T00:00:00+09:00"), now)).toBe("DAYS_31_90");
    expect(expirationBucketForEndDate(new Date("2026-04-15T00:00:00+09:00"), now)).toBe("DAYS_31_90");
  });

  it("buckets 91-180 days remaining as DAYS_91_180", () => {
    expect(expirationBucketForEndDate(new Date("2026-04-16T00:00:00+09:00"), now)).toBe("DAYS_91_180");
    expect(expirationBucketForEndDate(new Date("2026-07-14T00:00:00+09:00"), now)).toBe("DAYS_91_180");
  });

  it("buckets 181+ days remaining as DAYS_181_PLUS", () => {
    expect(expirationBucketForEndDate(new Date("2026-07-15T00:00:00+09:00"), now)).toBe("DAYS_181_PLUS");
  });

  it("EXPIRATION_BUCKETS enumerates all 8 buckets exactly once", () => {
    expect(EXPIRATION_BUCKETS).toHaveLength(8);
    expect(new Set(EXPIRATION_BUCKETS).size).toBe(8);
  });
});

describe("staleSignalBucketForAge (§16)", () => {
  it("buckets 0 and 7 days open as DAYS_0_7", () => {
    expect(staleSignalBucketForAge(now, now)).toBe("DAYS_0_7");
    expect(staleSignalBucketForAge(new Date("2026-01-08T12:00:00+09:00"), now)).toBe("DAYS_0_7");
  });

  it("buckets 8 and 14 days open as DAYS_8_14", () => {
    expect(staleSignalBucketForAge(new Date("2026-01-07T12:00:00+09:00"), now)).toBe("DAYS_8_14");
    expect(staleSignalBucketForAge(new Date("2026-01-01T12:00:00+09:00"), now)).toBe("DAYS_8_14");
  });

  it("buckets 61+ days open as DAYS_61_PLUS", () => {
    expect(staleSignalBucketForAge(new Date("2025-11-01T12:00:00+09:00"), now)).toBe("DAYS_61_PLUS");
  });

  it("STALE_SIGNAL_BUCKETS enumerates all 5 buckets exactly once", () => {
    expect(STALE_SIGNAL_BUCKETS).toHaveLength(5);
    expect(new Set(STALE_SIGNAL_BUCKETS).size).toBe(5);
  });
});

describe("monthKeyKst / monthRangeUtcBounds (§22 KST month boundary)", () => {
  it("formats a KST month key as YYYY-MM", () => {
    expect(monthKeyKst(new Date("2026-01-15T12:00:00+09:00"))).toBe("2026-01");
  });

  it("a UTC instant just before KST midnight belongs to the previous KST day/month", () => {
    // 2026-02-01T14:00:00Z is 2026-02-01 23:00 KST -> still February.
    // 2026-01-31T15:30:00Z is 2026-02-01 00:30 KST -> already February.
    expect(monthKeyKst(new Date("2026-01-31T14:30:00Z"))).toBe("2026-01");
    expect(monthKeyKst(new Date("2026-01-31T15:30:00Z"))).toBe("2026-02");
  });

  it("monthRangeUtcBounds produces a [start, endExclusive) pair whose KST keys match the requested month", () => {
    const { start, endExclusive } = monthRangeUtcBounds("2026-02");
    expect(monthKeyKst(start)).toBe("2026-02");
    expect(monthKeyKst(new Date(endExclusive.getTime() - 1))).toBe("2026-02");
    expect(monthKeyKst(endExclusive)).toBe("2026-03");
  });

  it("handles December -> January year rollover", () => {
    const { start, endExclusive } = monthRangeUtcBounds("2026-12");
    expect(monthKeyKst(start)).toBe("2026-12");
    expect(monthKeyKst(endExclusive)).toBe("2027-01");
  });
});

describe("lastNMonthsKst (§22 zero-fill)", () => {
  it("returns exactly N ascending month keys, ending with the current KST month", () => {
    const keys = lastNMonthsKst(12, now);
    expect(keys).toHaveLength(12);
    expect(keys[keys.length - 1]).toBe("2026-01");
    expect(keys[0]).toBe("2025-02");
    // Strictly ascending, no gaps or duplicates.
    expect(new Set(keys).size).toBe(12);
  });

  it("returns a single-element array for months=1", () => {
    expect(lastNMonthsKst(1, now)).toEqual(["2026-01"]);
  });
});

describe("subtractMonthsUtc", () => {
  it("subtracts whole calendar months", () => {
    const result = subtractMonthsUtc(new Date("2026-03-15T00:00:00Z"), 3);
    expect(result.toISOString()).toBe("2025-12-15T00:00:00.000Z");
  });
});
