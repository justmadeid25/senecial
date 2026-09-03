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
export const QUESTION_COMPLEXITY_VERSION = "keyword-heuristic-v2";

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
  // §AI 답변 품질 개편 - added after the audit found these under-covered:
  // a question asking what's DISADVANTAGEOUS/worth ATTENTION across the
  // whole contract ("내가 불리한 게 뭐야?", "주의할 조항 있어?", "꼭 봐야
  // 할 내용 알려줘") is just as comprehensive in SHAPE as "모든 조항을
  // 검토해줘" - it has no single clause topic to anchor retrieval to,
  // it implicitly means "scan the whole contract" - but none of the
  // original keywords above ever fire for it. Same deliberately
  // over-inclusive bias as the rest of this list (see this file's own
  // top-level docstring): misclassifying a narrow question as
  // comprehensive only costs a wider, still-correct retrieval.
  "불리한",
  "불리한지",
  "주의할",
  "주의해야",
  "봐야 할",
  "봐야할",
  "챙겨야",
  "체크해야",
  // §AI 답변 품질 개편 Phase 1.1 P0-2 - "내 입장에서 이상한 조건 있어?"
  // was measured (real-world evaluation) to fall through as "focused".
  // Deliberately kept as bounded PHRASES here, NOT the bare words
  // "이상한"/"문제" alone - unlike the standalone-keyword design above,
  // "문제" specifically is common enough in genuinely FOCUSED questions
  // ("문제 생기면 누가 책임져?" - a narrow liability question, also from
  // the same evaluation) that a bare match would misclassify it. Each
  // phrase below pairs the ambiguous word with the review-shape context
  // ("조항"/"조건"/"만한"/"해야 할") that only appears in an actual
  // broad-review request.
  "이상한 조건",
  "이상한 조항",
  "이상한 점",
  "특이한 조건",
  "특이한 조항",
  "문제될 만한",
  "문제될만한",
  "조심해야 할",
  "조심할",
];

export function classifyQuestionComplexity(question: string): QuestionComplexity {
  return COMPREHENSIVE_SIGNAL_KEYWORDS.some((keyword) => question.includes(keyword)) ? "comprehensive" : "focused";
}
