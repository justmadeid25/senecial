/** §Phase 13 Part H (§40) - the ONLY message shown to a user for a budget rejection - never provider internals, never the computed cost/threshold values (§40's "비용 계산 상세 공격 정보 노출" prohibition). */
export class AiBudgetExceededError extends Error {
  constructor() {
    super("이번 조직의 AI 사용 한도에 도달했습니다. 조직 관리자에게 문의해 주세요.");
    this.name = "AiBudgetExceededError";
  }
}
