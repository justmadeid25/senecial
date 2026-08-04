import type { AnalyticsFilterKey } from "@/domain/analytics/scope-metadata";

/** Korean display name for each of the 10 filter bar fields - used for chips (§7) and ignoredFilters notes (§8). */
export const ANALYTICS_FILTER_KEY_LABELS: Record<AnalyticsFilterKey, string> = {
  periodStart: "기간 시작일",
  periodEnd: "기간 종료일",
  contractType: "계약 유형",
  displayStatus: "표시 상태",
  counterpartyId: "상대방",
  currency: "통화",
  autoRenewal: "자동갱신 여부",
  clauseType: "조항 유형",
  signalStatus: "검토 신호 상태",
  signalType: "검토 신호 유형",
} as const;

export const ANALYTICS_DATE_BASIS_LABELS: Record<string, string> = {
  createdAt: "계약 생성일",
  endDate: "계약 종료일",
  jobCompletedAt: "최신 조항 분해 완료일",
  signalCreatedAt: "검토 신호 생성일",
  jobCreatedAt: "작업 생성일",
  fixedWindow: "고정 기간",
};
