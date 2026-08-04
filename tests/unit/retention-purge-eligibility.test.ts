import { describe, expect, it } from "vitest";

import { isPastRetention, purgeEligibleAt, retentionCutoff } from "@/domain/retention/purge-eligibility";

describe("purge-eligibility (§44)", () => {
  it("purgeEligibleAt adds retentionDays to the given date", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const eligibleAt = purgeEligibleAt(since, 30);
    expect(eligibleAt.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("isPastRetention is false before the window elapses", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-15T00:00:00.000Z");
    expect(isPastRetention(since, 30, now)).toBe(false);
  });

  it("isPastRetention is true exactly at the boundary instant (inclusive)", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-31T00:00:00.000Z");
    expect(isPastRetention(since, 30, now)).toBe(true);
  });

  it("isPastRetention is true well after the window elapses", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(isPastRetention(since, 30, now)).toBe(true);
  });

  it("retentionCutoff produces a value usable directly as a Prisma lte filter", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const cutoff = retentionCutoff(90, now);
    // a row with deletedAt <= cutoff is exactly the "90+ days old" set
    expect(isPastRetention(cutoff, 90, now)).toBe(true);
    expect(isPastRetention(new Date(cutoff.getTime() + 1), 90, now)).toBe(false);
  });
});
