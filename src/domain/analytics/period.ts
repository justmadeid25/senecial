import { kstDayIndexToUtcStart, toKstDayIndex } from "@/domain/contracts/get-computed-contract-status";
import { subtractMonthsUtc } from "@/domain/analytics/date-buckets";

export interface AnalyticsPeriodInput {
  periodStart?: Date;
  periodEnd?: Date;
}

export interface AnalyticsPeriod {
  /** Inclusive, KST calendar-day-aligned start instant. */
  start: Date;
  /** Exclusive end instant (the KST day after periodEnd, or today) - matches the day-boundary style used everywhere else in this codebase. */
  endExclusive: Date;
}

/**
 * §6/§48 - resolves the common period filter with safe fallbacks: an
 * invalid range (end before/equal start) or an out-of-bounds range never
 * throws, it silently falls back to the default window ending at the
 * resolved end date, and a too-wide range is clamped to maxMonths. Both
 * boundaries are aligned to KST calendar days via the same
 * toKstDayIndex/kstDayIndexToUtcStart primitives as getComputedContractStatus(),
 * so a period filter and the displayStatus EXPIRING/EXPIRED boundary never
 * disagree about where "today" starts.
 */
export function resolveAnalyticsPeriod(
  input: AnalyticsPeriodInput,
  now: Date,
  defaultMonths: number,
  maxMonths: number
): AnalyticsPeriod {
  const todayEndExclusive = kstDayIndexToUtcStart(toKstDayIndex(now) + 1);
  const endExclusive = input.periodEnd
    ? kstDayIndexToUtcStart(toKstDayIndex(input.periodEnd) + 1)
    : todayEndExclusive;

  let start = input.periodStart
    ? kstDayIndexToUtcStart(toKstDayIndex(input.periodStart))
    : subtractMonthsUtc(endExclusive, defaultMonths);

  if (start.getTime() >= endExclusive.getTime()) {
    start = subtractMonthsUtc(endExclusive, defaultMonths);
  }

  const earliestAllowedStart = subtractMonthsUtc(endExclusive, maxMonths);
  if (start.getTime() < earliestAllowedStart.getTime()) {
    start = earliestAllowedStart;
  }

  return { start, endExclusive };
}
