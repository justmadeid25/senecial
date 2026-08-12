/**
 * §Phase 14.1 §15 - "focused vs comprehensive" question handling, WITHOUT a
 * new agent/router and WITHOUT a forced extra LLM call per question: a
 * pure, cheap keyword heuristic over the question text, evaluated
 * synchronously alongside the existing pipeline (no network/DB call of its
 * own). A comprehensive question ("이 계약의 위험 조항을 모두 검토해줘",
 * "전체적으로 요약해줘") asks the retrieval leg to cast a much wider net
 * (see COMPREHENSIVE_TOP_K in retrieve-context.ts) than a focused,
 * single-fact question ("해지 조항이 뭐야?") ever needs - this is what lets
 * §12's comprehensive-review acceptance test find risks scattered across
 * many locations in one contract, without ever spawning a second LLM call
 * or a query-decomposition agent to get there.
 */
export type QuestionComplexity = "focused" | "comprehensive";

/** Bump if the keyword list or matching rule itself changes shape - included in the retrieval cache key indirectly via the topK it produces, so a stale cached "focused" retrieval is never served for what is now classified "comprehensive" once this changes. */
export const QUESTION_COMPLEXITY_VERSION = "keyword-heuristic-v1";

/**
 * Deliberately over-inclusive (a focused question misclassified as
 * comprehensive only costs a wider, still-correct retrieval - never a
 * wrong answer) rather than under-inclusive (missing a genuinely
 * comprehensive question would silently under-cover the contract, which
 * is exactly the failure §12 exists to catch). Korean legal-contract-review
 * request phrasing, not a general-purpose "is this a big question"
 * detector.
 */
const COMPREHENSIVE_SIGNAL_PATTERNS: readonly RegExp[] = [
  /모든\s*(조항|위험|리스크)/,
  /전체\s*(조항|계약|검토|요약)/,
  /전반적/,
  /전수\s*(검토|조사)/,
  /포괄적/,
  /위험\s*(조항|요소|사항).{0,10}(검토|분석|찾아|알려)/,
  /계약(서)?\s*(전체를?|전반을?).{0,10}(검토|분석|요약|리뷰)/,
  /리뷰해\s*줘/,
  /요약해\s*줘/,
  /빠짐없이/,
  /어떤\s*위험/,
];

export function classifyQuestionComplexity(question: string): QuestionComplexity {
  return COMPREHENSIVE_SIGNAL_PATTERNS.some((pattern) => pattern.test(question)) ? "comprehensive" : "focused";
}
