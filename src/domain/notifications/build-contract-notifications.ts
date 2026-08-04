import { ContractStatus } from "@/generated/prisma/enums";
import { toKstDayIndex } from "@/domain/contracts/get-computed-contract-status";

import { NOTIFICATION_TYPES, type NotificationType } from "./notification-types";

/** Manual statuses are excluded from expiration notifications - mirrors getComputedContractStatus()'s MANUAL_STATUSES. */
const EXCLUDED_STATUSES: ReadonlySet<ContractStatus> = new Set([
  ContractStatus.DRAFT,
  ContractStatus.TERMINATED,
  ContractStatus.ARCHIVED,
]);

const EXPIRATION_THRESHOLDS: ReadonlyArray<{ type: NotificationType; days: number }> = [
  { type: NOTIFICATION_TYPES.EXPIRATION_30D, days: 30 },
  { type: NOTIFICATION_TYPES.EXPIRATION_14D, days: 14 },
  { type: NOTIFICATION_TYPES.EXPIRATION_7D, days: 7 },
  { type: NOTIFICATION_TYPES.EXPIRATION_1D, days: 1 },
  { type: NOTIFICATION_TYPES.EXPIRATION_TODAY, days: 0 },
];

// Local KST calendar-date formatter, deliberately not imported from
// lib/format/date.ts - domain modules only depend on other domain modules
// and stdlib, never on the lib/ layer, matching the rest of this codebase.
const kstDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toKstDateKey(date: Date): string {
  return kstDateKeyFormatter.format(date);
}

export interface ContractNotificationInput {
  id: string;
  title: string;
  status: ContractStatus;
  endDate: Date | null;
  autoRenewal: boolean;
  noticePeriodDays: number | null;
}

export interface ContractNotificationCandidate {
  type: NotificationType;
  title: string;
  message: string;
  eventKey: string;
  scheduledFor: Date;
}

/**
 * Pure function: given one contract and "now", returns zero or more
 * notification candidates that should exist as of today. Each threshold
 * (30/14/7/1/0 days) is an exact calendar-day match, not a "within N
 * days" window - this is what makes the eventKey (which embeds today's
 * KST date) a stable dedup key across reruns on the same day, and a
 * distinct one on each subsequent day. A daily cron run is the intended
 * deployment model; if a run is skipped entirely on the exact day a
 * threshold falls on, that specific notification is not retroactively
 * generated (documented limitation - see README).
 */
export function buildContractNotifications(
  contract: ContractNotificationInput,
  now: Date
): ContractNotificationCandidate[] {
  if (EXCLUDED_STATUSES.has(contract.status)) {
    return [];
  }

  const candidates: ContractNotificationCandidate[] = [];
  const dateKey = toKstDateKey(now);

  if (contract.endDate) {
    const daysRemaining = toKstDayIndex(contract.endDate) - toKstDayIndex(now);
    const matchedThreshold = EXPIRATION_THRESHOLDS.find((t) => t.days === daysRemaining);

    if (matchedThreshold) {
      const label = matchedThreshold.days === 0 ? "오늘" : `${matchedThreshold.days}일 후`;
      candidates.push({
        type: matchedThreshold.type,
        title: `계약 만료 예정: ${contract.title}`,
        message: `"${contract.title}" 계약이 ${label} 만료됩니다.`,
        eventKey: `contract:${contract.id}:expiration:${matchedThreshold.days}d:${dateKey}`,
        scheduledFor: now,
      });
    }

    if (contract.autoRenewal && contract.noticePeriodDays !== null) {
      const noticeDayIndex = toKstDayIndex(contract.endDate) - contract.noticePeriodDays;
      if (noticeDayIndex === toKstDayIndex(now)) {
        candidates.push({
          type: NOTIFICATION_TYPES.RENEWAL_NOTICE_DUE,
          title: `자동갱신 통보 기한 도래: ${contract.title}`,
          message: `"${contract.title}" 계약의 해지 통보 기한이 오늘입니다 (자동갱신 예정).`,
          eventKey: `contract:${contract.id}:renewal-notice:${dateKey}`,
          scheduledFor: now,
        });
      }
    }
  }

  return candidates;
}
