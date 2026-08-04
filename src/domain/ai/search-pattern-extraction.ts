import { extractKeywords, KEYWORD_STEM_LENGTH } from "./keyword-extraction";

/**
 * §Organization Memory (Phase 12 Part K) - "집계 통계만 저장, 개인정보 없음".
 * Extracts short keyword STEMS from a question (the same 2-char
 * accommodation the hybrid search keyword leg and evidence-sentence
 * scoring already use for Korean's agglutinative morphology) - never the
 * raw question text itself, never anything tied to a specific user. A
 * 2-character stem carries no identifying information on its own; only
 * the aggregate count across many questions is ever meaningful.
 */
export function extractSearchPatternKeys(question: string): string[] {
  const keywords = extractKeywords(question);
  return [...new Set(keywords.map((keyword) => keyword.slice(0, KEYWORD_STEM_LENGTH)))];
}
