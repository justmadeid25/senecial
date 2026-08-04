import type { Citation } from "./citation";

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
const MIN_CITATION_SCORE = Number(process.env.AI_MIN_CITATION_SCORE ?? "0.15");
const MIN_CITATION_COUNT = Number(process.env.AI_MIN_CITATION_COUNT ?? "1");

export const UNKNOWN_ANSWER_TEXT =
  "죄송합니다. 제공된 계약 자료에서 이 질문에 대한 근거를 충분히 찾지 못했습니다. " +
  "질문을 조금 더 구체적으로 다시 표현해 보시거나, 관련 계약을 직접 확인해 주세요.";

export interface EvidenceSufficiencyResult {
  sufficient: boolean;
  strongCitations: Citation[];
}

/** Pure - never touches the DB/LLM itself, only decides based on scores already computed by retrieval. */
export function checkEvidenceSufficiency(citations: readonly Citation[]): EvidenceSufficiencyResult {
  const strongCitations = citations.filter((citation) => citation.score >= MIN_CITATION_SCORE);
  return { sufficient: strongCitations.length >= MIN_CITATION_COUNT, strongCitations };
}
