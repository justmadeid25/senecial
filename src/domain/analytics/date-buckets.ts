import { toKstDayIndex } from "@/domain/contracts/get-computed-contract-status";

/**
 * Analytics-only date bucketing. Reuses the same KST calendar-day primitives
 * as getComputedContractStatus() (toKstDayIndex/kstDayIndexToUtcStart) so
 * expiration-distribution buckets never disagree with the displayStatus
 * EXPIRED/EXPIRING boundary shown elsewhere in the app.
 */

export const EXPIRATION_BUCKETS = [
  "EXPIRED",
  "TODAY",
  "DAYS_1_7",
  "DAYS_8_30",
  "DAYS_31_90",
  "DAYS_91_180",
  "DAYS_181_PLUS",
  "NO_END_DATE",
] as const;

export type ExpirationBucket = (typeof EXPIRATION_BUCKETS)[number];

export const EXPIRATION_BUCKET_LABELS: Record<ExpirationBucket, string> = {
  EXPIRED: "이미 만료",
  TODAY: "오늘",
  DAYS_1_7: "1~7일",
  DAYS_8_30: "8~30일",
  DAYS_31_90: "31~90일",
  DAYS_91_180: "91~180일",
  DAYS_181_PLUS: "181일 이상",
  NO_END_DATE: "종료일 없음",
};

/** §9 - the same day-boundary rules as getComputedContractStatus(), just bucketed more finely. */
export function expirationBucketForEndDate(endDate: Date | null, now: Date): ExpirationBucket {
  if (!endDate) {
    return "NO_END_DATE";
  }
  const daysRemaining = toKstDayIndex(endDate) - toKstDayIndex(now);
  if (daysRemaining < 0) {
    return "EXPIRED";
  }
  if (daysRemaining === 0) {
    return "TODAY";
  }
  if (daysRemaining <= 7) {
    return "DAYS_1_7";
  }
  if (daysRemaining <= 30) {
    return "DAYS_8_30";
  }
  if (daysRemaining <= 90) {
    return "DAYS_31_90";
  }
  if (daysRemaining <= 180) {
    return "DAYS_91_180";
  }
  return "DAYS_181_PLUS";
}

export const STALE_SIGNAL_BUCKETS = ["DAYS_0_7", "DAYS_8_14", "DAYS_15_30", "DAYS_31_60", "DAYS_61_PLUS"] as const;
export type StaleSignalBucket = (typeof STALE_SIGNAL_BUCKETS)[number];

export const STALE_SIGNAL_BUCKET_LABELS: Record<StaleSignalBucket, string> = {
  DAYS_0_7: "0~7일",
  DAYS_8_14: "8~14일",
  DAYS_15_30: "15~30일",
  DAYS_31_60: "31~60일",
  DAYS_61_PLUS: "61일 이상",
};

/** §16 - days elapsed since an OPEN signal was created, bucketed for prioritization only (never a risk score). */
export function staleSignalBucketForAge(createdAt: Date, now: Date): StaleSignalBucket {
  const daysOpen = toKstDayIndex(now) - toKstDayIndex(createdAt);
  if (daysOpen <= 7) {
    return "DAYS_0_7";
  }
  if (daysOpen <= 14) {
    return "DAYS_8_14";
  }
  if (daysOpen <= 30) {
    return "DAYS_15_30";
  }
  if (daysOpen <= 60) {
    return "DAYS_31_60";
  }
  return "DAYS_61_PLUS";
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstShifted(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** "YYYY-MM" for the KST calendar month a UTC instant falls in - the key used throughout §22's monthly trends. */
export function monthKeyKst(date: Date): string {
  const shifted = kstShifted(date);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** [start, endExclusive) as UTC instants for the KST calendar month named by monthKey. */
export function monthRangeUtcBounds(monthKey: string): { start: Date; endExclusive: Date } {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const start = new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS);
  const endExclusive = new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS);
  return { start, endExclusive };
}

/**
 * The last `count` KST calendar months as ascending "YYYY-MM" keys, always
 * including the current month - used to zero-fill §22's monthly trend
 * charts so empty months render as 0 instead of being omitted.
 */
export function lastNMonthsKst(count: number, now: Date): string[] {
  const shifted = kstShifted(now);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth(); // 0-indexed
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const totalMonths = year * 12 + month - i;
    const bucketYear = Math.floor(totalMonths / 12);
    const bucketMonth = ((totalMonths % 12) + 12) % 12;
    keys.push(`${bucketYear}-${String(bucketMonth + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** Subtracts whole calendar months from a UTC instant (JS Date month-overflow rules apply). */
export function subtractMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}
