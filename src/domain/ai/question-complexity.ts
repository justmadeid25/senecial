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
 *
 * Deliberately standalone keywords, not adjacency-bound phrases
 * (e.g. NOT `/모든\s*조항/`) - real questions put the scope word and the
 * review verb anywhere in the sentence ("이 계약에서 위험할 수 있는 조항을
 * 모두 검토해줘" has "위험"...조항...모두...검토 in that order, nowhere
 * adjacent) - see tests/unit/question-complexity.test.ts /
 * ai-comprehensive-review-coverage.test.ts's real question phrasing, which
 * is exactly what caught the original adjacency-bound version missing this.
 */
const COMPREHENSIVE_SIGNAL_KEYWORDS: readonly string[] = [
  "모든",
  "모두",
  "전체",
  "전반",
  "전수",
  "포괄적",
  "빠짐없이",
  "리뷰해",
  "요약해",
];

export function classifyQuestionComplexity(question: string): QuestionComplexity {
  return COMPREHENSIVE_SIGNAL_KEYWORDS.some((keyword) => question.includes(keyword)) ? "comprehensive" : "focused";
}
