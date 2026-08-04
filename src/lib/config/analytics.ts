const DEFAULT_MONTHS = 12;
const DEFAULT_MAX_DATE_RANGE_MONTHS = 60;
const DEFAULT_CSV_MAX_ROWS = 10000;

function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

/** Default period length (§6) applied when no explicit date range filter is given. */
export const ANALYTICS_DEFAULT_MONTHS = parsePositiveInt(
  process.env.ANALYTICS_DEFAULT_MONTHS,
  DEFAULT_MONTHS,
  "ANALYTICS_DEFAULT_MONTHS"
);

/** Widest date range a period filter is allowed to span (§6) - wider requests are clamped, never rejected. */
export const ANALYTICS_MAX_DATE_RANGE_MONTHS = parsePositiveInt(
  process.env.ANALYTICS_MAX_DATE_RANGE_MONTHS,
  DEFAULT_MAX_DATE_RANGE_MONTHS,
  "ANALYTICS_MAX_DATE_RANGE_MONTHS"
);

/** Hard cap on CSV export row count (§29/§48) - never unbounded. */
export const ANALYTICS_CSV_MAX_ROWS = parsePositiveInt(
  process.env.ANALYTICS_CSV_MAX_ROWS,
  DEFAULT_CSV_MAX_ROWS,
  "ANALYTICS_CSV_MAX_ROWS"
);
