import type { AnalyticsFilterKey } from "@/domain/analytics/scope-metadata";

/**
 * Phase 8.1 §6 - the single source of truth for "which of the 10 filter
 * bar fields actually narrow which analytics section". Both the query
 * services (to compute appliedFilters/ignoredFilters, §8) and the README's
 * filter matrix table are derived from this constant, so the two can never
 * drift apart.
 *
 * periodDefault:
 *  - "none": no period filter unless the user explicitly sets one (a
 *    whole-portfolio/current-state section - see §2's "기본적으로 기간
 *    미적용" row).
 *  - "last12Months": defaults to ANALYTICS_DEFAULT_MONTHS when unset (a
 *    period-aggregate section).
 *  - "fixedWindow": the section has its own fixed N-month window
 *    (monthly trends) that periodStart/periodEnd never resizes - only the
 *    other filters narrow each month's counts.
 */
export const ANALYTICS_FILTER_MATRIX = {
  portfolio: {
    label: "계약 포트폴리오 요약",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
    ],
    dateBasis: "createdAt",
    periodDefault: "none",
  },
  expiration: {
    label: "만료 일정 분포",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
    ],
    dateBasis: "endDate",
    periodDefault: "none",
  },
  contractType: {
    label: "계약 유형 분포",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
    ],
    dateBasis: "createdAt",
    periodDefault: "last12Months",
  },
  clauseType: {
    label: "조항 유형 분포",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
      "clauseType",
    ],
    dateBasis: "jobCompletedAt",
    periodDefault: "last12Months",
  },
  reviewSignals: {
    label: "검토 신호 통계",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
      "clauseType",
      "signalStatus",
      "signalType",
    ],
    dateBasis: "signalCreatedAt",
    periodDefault: "last12Months",
  },
  counterparties: {
    label: "상대방 분석",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
    ],
    dateBasis: "createdAt",
    periodDefault: "none",
  },
  processing: {
    label: "처리 파이프라인 운영 현황",
    supportedFilterKeys: [
      "periodStart",
      "periodEnd",
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
    ],
    dateBasis: "jobCreatedAt",
    periodDefault: "none",
  },
  monthlyTrends: {
    label: "기간별 추이",
    supportedFilterKeys: [
      "contractType",
      "displayStatus",
      "counterpartyId",
      "currency",
      "autoRenewal",
      "clauseType",
      "signalStatus",
      "signalType",
    ],
    dateBasis: "fixedWindow",
    periodDefault: "fixedWindow",
  },
  knowledge: {
    label: "조직 지식 요약",
    supportedFilterKeys: ["contractType", "displayStatus", "counterpartyId", "currency", "autoRenewal", "clauseType"],
    dateBasis: undefined,
    periodDefault: "none",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    supportedFilterKeys: readonly AnalyticsFilterKey[];
    dateBasis: "createdAt" | "endDate" | "jobCompletedAt" | "signalCreatedAt" | "jobCreatedAt" | "fixedWindow" | undefined;
    periodDefault: "none" | "last12Months" | "fixedWindow";
  }
>;

export type AnalyticsSection = keyof typeof ANALYTICS_FILTER_MATRIX;
