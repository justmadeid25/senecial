import type { Citation } from "./citation";
import type { QuestionComplexity } from "./question-complexity";

/**
 * §Hallucination Guard - "답변 생성 전 근거 개수 확인, 근거 부족 → 모른다고
 * 답변, 근거 없는 추론 금지". This check runs BEFORE the LLM is ever
 * invoked (see features/ai/server/ask-question.ts) - insufficient
 * evidence short-circuits straight to `UNKNOWN_ANSWER_TEXT`, a fixed
 * (not LLM-generated) string, so there is no chance for the model to
 * "fill the gap" with an unsupported guess.
 *
 * `MIN_CITATION_SCORE` filters out citations that only barely matched
 * (e.g. one incidental keyword overlap with no real vector similarity) -
 * counting those toward "enough evidence" would defeat the whole point of
 * this guard. Calibrated (together with hybrid-search-scoring.ts's 0.6/0.4
 * keyword/vector weighting) against real scores from this codebase's own
 * tests: a junk pseudo-clause (a document's title line, segmented with no
 * real clause number) scores ~0.11 on pure vector noise for a genuinely
 * unrelated question (tests/integration/hybrid-search.test.ts,
 * tests/e2e/ai-conversation-flow.spec.ts), while true-positive matches -
 * including ones with only modest vector similarity but real keyword-stem
 * overlap (tests/integration/ai-evaluation.test.ts's golden-dataset q4,
 * ~0.18) - score meaningfully higher. Both constants remain
 * env-overridable for tuning without a code change.
 */
export const MIN_CITATION_SCORE = Number(process.env.AI_MIN_CITATION_SCORE ?? "0.15");
export const MIN_CITATION_COUNT = Number(process.env.AI_MIN_CITATION_COUNT ?? "1");

/**
 * §Phase 14.1 §12 - a SEPARATE, lower bar for a question classified
 * "comprehensive" (question-complexity.ts). `MIN_CITATION_SCORE` above was
 * calibrated against FOCUSED single-fact questions, where one query
 * embedding closely matches one specific clause. A comprehensive review
 * question ("이 계약의 위험 조항을 모두 검토해줘") embeds as one broad,
 * topically-diluted vector - real, relevant evidence scattered across many
 * unrelated articles scores meaningfully LOWER against that single blended
 * vector than the same evidence would against its own focused question,
 * even though it is still genuine (not noise). Measured directly building
 * this feature (tests/integration/ai-comprehensive-review-coverage.test.ts):
 * a synthetic contract with 7 risk clauses scattered among 14 boilerplate
 * ones - COMPREHENSIVE_TOP_K's wider candidate pool found 6/7 in the raw
 * retrieval, but the original single MIN_CITATION_SCORE=0.15 gate then
 * dropped legitimate risk-clause scores as low as 0.116-0.146, keeping
 * only 2/7 in the final answer. 0.10 is the real, measured value that
 * keeps that fixture's genuine scattered evidence without needing a
 * second LLM call or query decomposition - just a threshold appropriate to
 * this question SHAPE. `MIN_CITATION_SCORE` itself is untouched, so a
 * focused question's hallucination-guard strictness never weakens.
 */
export const MIN_CITATION_SCORE_COMPREHENSIVE = Number(process.env.AI_MIN_CITATION_SCORE_COMPREHENSIVE ?? "0.10");

/**
 * §Phase 12.2 Part C - identifies which version of this guard's DECISION
 * LOGIC (not just its threshold values, which are already captured
 * separately as MIN_CITATION_SCORE/MIN_CITATION_COUNT) is live. Bump only
 * if checkEvidenceSufficiency()'s actual algorithm changes shape (e.g. a
 * future per-citation weighting scheme), not for a threshold-only retune.
 */
export const HALLUCINATION_GUARD_VERSION = "v1";

export const UNKNOWN_ANSWER_TEXT =
  "죄송합니다. 제공된 계약 자료에서 이 질문에 대한 근거를 충분히 찾지 못했습니다. " +
  "질문을 조금 더 구체적으로 다시 표현해 보시거나, 관련 계약을 직접 확인해 주세요.";

export interface EvidenceSufficiencyResult {
  sufficient: boolean;
  strongCitations: Citation[];
}

/**
 * Pure - never touches the DB/LLM itself, only decides based on scores
 * already computed by retrieval. `complexity` defaults to "focused" (the
 * original, unchanged behavior) - only a caller that has actually
 * classified the question as "comprehensive" gets the relaxed threshold.
 */
export function checkEvidenceSufficiency(
  citations: readonly Citation[],
  complexity: QuestionComplexity = "focused"
): EvidenceSufficiencyResult {
  const threshold = complexity === "comprehensive" ? MIN_CITATION_SCORE_COMPREHENSIVE : MIN_CITATION_SCORE;
  const strongCitations = citations.filter((citation) => citation.score >= threshold);
  return { sufficient: strongCitations.length >= MIN_CITATION_COUNT, strongCitations };
}
