import { resolveAnalyticsPeriod } from "@/domain/analytics/period";

export type PeriodDefaultPolicy = "none" | "last12Months" | "fixedWindow";

export interface ResolvedSectionPeriod {
  from?: Date;
  to?: Date;
  applied: boolean;
}

/**
 * Phase 8.1 §2 - resolves ONE section's period window per its own default
 * policy (see domain/analytics/filter-matrix.ts's `periodDefault`):
 *
 *  - "none": only narrows when the user explicitly set periodStart/periodEnd
 *    (a whole-portfolio/current-state section stays unfiltered by default).
 *  - "last12Months": always resolves to a window (falls back to the last
 *    ANALYTICS_DEFAULT_MONTHS when unset) - a period-aggregate section.
 *  - "fixedWindow": period never applies here at all (the section has its
 *    own fixed N-month loop elsewhere, e.g. monthly trends).
 */
export function resolveSectionPeriod(
  filters: { periodStart?: Date; periodEnd?: Date },
  policy: PeriodDefaultPolicy,
  now: Date,
  defaultMonths: number,
  maxMonths: number
): ResolvedSectionPeriod {
  if (policy === "fixedWindow") {
    return { applied: false };
  }

  const hasExplicitInput = filters.periodStart !== undefined || filters.periodEnd !== undefined;

  if (policy === "none" && !hasExplicitInput) {
    return { applied: false };
  }

  const period = resolveAnalyticsPeriod(filters, now, defaultMonths, maxMonths);
  return { from: period.start, to: period.endExclusive, applied: true };
}
