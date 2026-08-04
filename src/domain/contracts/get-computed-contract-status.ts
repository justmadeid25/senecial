import { ContractStatus } from "@/generated/prisma/enums";

/**
 * Contract statuses a user sets explicitly and that auto-computation must
 * never override.
 */
const MANUAL_STATUSES: ReadonlySet<ContractStatus> = new Set([
  ContractStatus.DRAFT,
  ContractStatus.TERMINATED,
  ContractStatus.ARCHIVED,
]);

/** Inclusive day-count window for the EXPIRING status. */
export const EXPIRING_WINDOW_DAYS = 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Number of whole calendar days since the epoch, as observed in KST
 * (UTC+9). Contract end dates are business calendar dates, not exact
 * instants, so status transitions must be computed on the KST calendar day
 * boundary rather than a raw millisecond comparison - otherwise a contract
 * ending "today" (KST) would flip to EXPIRED at an arbitrary UTC moment
 * partway through the Korean business day.
 */
export function toKstDayIndex(date: Date): number {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / MS_PER_DAY);
}

/** Inverse of toKstDayIndex(): the UTC instant at 00:00:00 KST of that day. */
export function kstDayIndexToUtcStart(dayIndex: number): Date {
  return new Date(dayIndex * MS_PER_DAY - KST_OFFSET_MS);
}

export interface ContractStatusInput {
  status: ContractStatus;
  endDate: Date | null;
}

/**
 * Computes the status to *display* for a contract, without mutating the
 * stored status. DB rows are never batch-updated by this - see Phase 3
 * README section on computed vs stored status.
 *
 * Rules:
 * - DRAFT / TERMINATED / ARCHIVED are manual states and are never touched.
 * - No endDate -> keep the current status.
 * - endDate's KST calendar day is before today (KST) -> EXPIRED.
 * - 0-30 days remaining (inclusive) -> EXPIRING.
 * - 31+ days remaining -> keep the current status (usually ACTIVE).
 */
export function getComputedContractStatus(
  contract: ContractStatusInput,
  now: Date
): ContractStatus {
  const { status, endDate } = contract;

  if (MANUAL_STATUSES.has(status)) {
    return status;
  }

  if (!endDate) {
    return status;
  }

  const daysRemaining = toKstDayIndex(endDate) - toKstDayIndex(now);

  if (daysRemaining < 0) {
    return ContractStatus.EXPIRED;
  }

  if (daysRemaining <= EXPIRING_WINDOW_DAYS) {
    return ContractStatus.EXPIRING;
  }

  return status;
}
