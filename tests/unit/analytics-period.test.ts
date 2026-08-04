import { describe, expect, it } from "vitest";

import { resolveAnalyticsPeriod } from "@/domain/analytics/period";

const now = new Date("2026-07-15T12:00:00+09:00"); // KST noon, Jul 15 2026

describe("resolveAnalyticsPeriod (§6/§48 safe defaults)", () => {
  it("defaults endExclusive to the KST day after 'today'", () => {
    const period = resolveAnalyticsPeriod({}, now, 12, 60);
    // now = 2026-07-15T12:00 KST -> tomorrow's KST midnight = 2026-07-16T00:00+09:00 = 2026-07-15T15:00Z.
    expect(period.endExclusive.toISOString()).toBe("2026-07-15T15:00:00.000Z");
    expect(period.start.getTime()).toBeLessThan(period.endExclusive.getTime());
  });

  it("a 12-month default window is roughly 365 days wide", () => {
    const period = resolveAnalyticsPeriod({}, now, 12, 60);
    const days = (period.endExclusive.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it("respects an explicit periodStart/periodEnd within the allowed range", () => {
    const periodStart = new Date("2026-01-01T00:00:00+09:00");
    const periodEnd = new Date("2026-01-31T00:00:00+09:00");
    const period = resolveAnalyticsPeriod({ periodStart, periodEnd }, now, 12, 60);
    expect(period.start.toISOString()).toBe("2025-12-31T15:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-01-31T15:00:00.000Z");
  });

  it("falls back to the default window when periodEnd is before periodStart (invalid range)", () => {
    const periodStart = new Date("2026-06-01T00:00:00+09:00");
    const periodEnd = new Date("2026-01-01T00:00:00+09:00");
    const period = resolveAnalyticsPeriod({ periodStart, periodEnd }, now, 12, 60);
    // Falls back to [end - 12 months, end] using the (earlier) periodEnd as the anchor.
    const days = (period.endExclusive.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it("clamps a too-wide range to maxMonths instead of rejecting it", () => {
    const periodStart = new Date("2000-01-01T00:00:00+09:00");
    const period = resolveAnalyticsPeriod({ periodStart }, now, 12, 24);
    const days = (period.endExclusive.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000);
    // Clamped to ~24 months, not the ~26 years requested.
    expect(days).toBeGreaterThan(700);
    expect(days).toBeLessThan(760);
  });

  it("never throws for any combination of missing/invalid inputs", () => {
    expect(() => resolveAnalyticsPeriod({}, now, 12, 60)).not.toThrow();
    expect(() =>
      resolveAnalyticsPeriod({ periodStart: now, periodEnd: now }, now, 12, 60)
    ).not.toThrow();
  });
});
