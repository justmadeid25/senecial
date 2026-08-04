import type { Citation } from "./citation";
import { findCitationMarkers } from "./citation-marker";

/**
 * §Phase 12.2 Part C - identifies which version of citation-validation
 * logic (this file's assertEveryParagraphHasCitation + citation.ts's
 * assertCitationsPresent, together - they are always deployed as one unit)
 * produced/verified a given AI answer. Bump if the marker-matching rule or
 * per-paragraph requirement ever changes shape.
 */
export const CITATION_VALIDATOR_VERSION = "v1";

/**
 * §Citation Required - "모든 문단 citation 없으면 출력 거부". Called on the
 * FINAL assembled answer (after streaming completes, before it is
 * persisted as a Message and before the stream is considered "done" to
 * the client - see features/ai/server/ask-question.ts). Splits on blank
 * lines (paragraph boundaries) and requires every non-empty paragraph to
 * contain at least one `[출처: ...]` marker that matches one of the
 * citations actually provided to the LLM - a marker referencing a
 * citation that was never in the retrieved set is NOT accepted (that
 * would mean the model fabricated a source).
 *
 * Precondition: `citations` must be non-empty - the hallucination guard
 * (hallucination-guard.ts) is responsible for short-circuiting to a fixed
 * "모른다" response BEFORE the LLM is ever invoked when there is no
 * evidence at all, so this function is never reached with zero citations
 * in the real pipeline; it throws defensively if that invariant is ever
 * violated, rather than silently accepting an uncited answer.
 */
export function assertEveryParagraphHasCitation(answerText: string, citations: readonly Citation[]): void {
  if (citations.length === 0) {
    throw new Error(
      "citation 없이는 답변을 검증할 수 없습니다 - 근거가 없으면 이 함수 이전에 hallucination guard가 처리해야 합니다."
    );
  }

  const paragraphs = answerText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    throw new Error("빈 답변은 출력할 수 없습니다.");
  }

  for (const paragraph of paragraphs) {
    const markers = findCitationMarkers(paragraph);
    const hasValidMarker = markers.some((marker) =>
      citations.some(
        (citation) => citation.clauseReference === marker.clauseReference && citation.contractTitle === marker.contractTitle
      )
    );
    if (!hasValidMarker) {
      throw new Error(`citation 표시가 없는 문단이 있어 출력을 거부합니다: "${paragraph.slice(0, 80)}"`);
    }
  }
}
