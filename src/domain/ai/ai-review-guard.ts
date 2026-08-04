/**
 * §AI Review (Phase 12 Part J) - "AI는 절대 '위험하다'는 표현을 쓰지 않는다.
 * 차이점과 근거만 제시한다." The system prompt (prompt-builder.ts) already
 * instructs the LLM never to produce a risk/safety verdict, but that is a
 * request, not a guarantee - a real production LLM provider could still
 * drift. This is the defense-in-depth check that runs on every AI review
 * narrative before it is ever returned to a caller, mirroring the same
 * "banned phrase" list already enforced for rule-based signals (see
 * domain/clauses/labels.ts and tests/unit/clause-labels-safety.test.ts).
 */
/**
 * §Phase 12.2 Part C - identifies which version of the banned-term list
 * below is live. Bump whenever a term is added/removed/reworded.
 */
export const RISK_LANGUAGE_GUARD_VERSION = "v1";

const BANNED_JUDGMENT_TERMS = [
  "위험한 조항",
  "위험합니다",
  "위험해요",
  "안전한 조항",
  "안전합니다",
  "불법",
  "무효",
  "반드시 수정해야 합니다",
  "체결하면 안 됩니다",
  "법적으로 문제가 있습니다",
];

export class RiskJudgmentLanguageError extends Error {
  constructor(public readonly matchedTerm: string) {
    super(`AI review output contains banned risk-judgment language: "${matchedTerm}"`);
    this.name = "RiskJudgmentLanguageError";
  }
}

/** Throws RiskJudgmentLanguageError if any banned term is present - never silently strips or rewrites. */
export function assertNoRiskJudgmentLanguage(text: string): void {
  for (const term of BANNED_JUDGMENT_TERMS) {
    if (text.includes(term)) {
      throw new RiskJudgmentLanguageError(term);
    }
  }
}
