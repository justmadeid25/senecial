/**
 * §3 - required disclaimer for every analytics screen. Render this,
 * verbatim, via the shared AnalyticsDisclaimer component - never
 * paraphrase or drop it per-section.
 */
export const ANALYTICS_DISCLAIMER =
  "이 분석은 조직의 계약 현황과 검토 작업을 정리하기 위한 참고 자료입니다. 법률적 위험이나 계약의 유효성을 판단하지 않습니다.";

/** §12 - amount figures are raw input values, not period/frequency-normalized. */
export const AMOUNT_BASIS_NOTE =
  "계약 금액은 입력된 원본 값을 기준으로 합산됩니다. 지급 주기나 계약 기간을 반영한 연환산 금액이 아닙니다.";

/** §18 - explains what the "repeated difference" statistics measure and don't measure. */
export const RECURRING_DIFFERENCE_NOTE =
  "반복 차이 통계는 기준 조항과 계약 조항 사이의 문자열·숫자·날짜·금액 차이가 얼마나 자주 나타나는지 집계한 것으로, 어느 쪽이 옳은지 판단하지 않습니다.";

/** §16 - the stale-signal age buckets are a work-prioritization aid, not a risk signal. */
export const STALE_SIGNAL_NOTE =
  "미처리 기간은 검토 작업의 우선순위를 정하는 데 참고하기 위한 지표이며 법률적 위험도를 의미하지 않습니다.";

/** §17 - a standard's comparison-view count reflects usage, not legal quality. */
export const STANDARD_USAGE_NOTE =
  "조회 횟수는 기준 조항이 얼마나 자주 참고되었는지를 보여줄 뿐, 그 내용의 적정성을 의미하지 않습니다.";

export function formatCurrencyGroupCount(currencyCount: number): string {
  if (currencyCount === 0) {
    return "0";
  }
  if (currencyCount === 1) {
    return "1개 통화";
  }
  return `${currencyCount}개 통화`;
}

/** §11/§34 - guards a ratio display against a zero denominator instead of producing NaN/Infinity. */
export function safePercentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}
