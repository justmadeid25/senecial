import type { Citation } from "./citation";
import { findCitationMarkers } from "./citation-marker";

/**
 * §Phase 12.2 Part C - identifies which version of citation-validation
 * logic (this file's assertEveryParagraphHasCitation + citation.ts's
 * assertCitationsPresent, together - they are always deployed as one unit)
 * produced/verified a given AI answer. Bump if the marker-matching rule or
 * per-paragraph requirement ever changes shape.
 *
 * §AI 답변 품질 개편 Phase 1.4 (real-OpenAI rerun regression) - v2 reflects
 * citation-marker.ts's own findCitationMarkers() now splitting a combined
 * "[출처: 제4조, 제5조 - 계약명]" bracket into two independently-validated
 * markers (see that module's splitCombinedReference()) - a real change to
 * what "matches a real citation" means, even though nothing in THIS file
 * changed.
 */
export const CITATION_VALIDATOR_VERSION = "v2";

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

/**
 * §AI 답변 품질 개편 P0-4 - block-aware grounding validation, used ONLY by
 * ask-question.ts's Q&A pipeline (askQuestion/askQuestionStreaming) and
 * run-shadow-evaluation.ts's shadow-provider check. Deliberately additive,
 * NOT a replacement for assertEveryParagraphHasCitation() above - that
 * function's exact current behavior (every paragraph, no exceptions) stays
 * live and unchanged for generate-ai-clause-review.ts / the evaluation
 * report / every existing test, none of which use the new tagged-block
 * prompt format this function understands.
 *
 * The problem this solves: requiring a citation marker on EVERY paragraph
 * (including a natural opening "네, 자동 갱신되는 구조입니다" conclusion or
 * a closing "따라서 계약 종료일을 먼저 확인하세요" action sentence) made a
 * hard, mid-stream failure ordinary for the LLM to trigger, and the
 * failure looked to the end user like a silently truncated, broken answer
 * (see docs audit). The system prompt (prompt-builder.ts) now asks the
 * model to prefix each paragraph with one of three closed-set tags -
 * ANSWER_BLOCK_TAGS - identifying what KIND of paragraph it is. Only
 * "evidence" paragraphs (and any UNTAGGED paragraph - the safe default,
 * see parseAnswerBlock()) still require a valid citation marker, exactly
 * as strictly as before. "conclusion"/"action" paragraphs may omit a
 * marker entirely, but if the model includes one anyway, it is still
 * validated against the real supplied citations - a fabricated/
 * nonexistent marker is rejected in EVERY block type, never just the
 * strict ones.
 */
export const ANSWER_BLOCK_TAGS = {
  conclusion: "[결론]",
  evidence: "[근거]",
  action: "[확인사항]",
} as const;

export type AnswerBlockType = "conclusion" | "evidence" | "action";

export interface ParsedAnswerBlock {
  type: AnswerBlockType;
  /** The paragraph's own text with the leading tag (if any) stripped - this is what actually reaches the user, never the raw "[결론] ..." form. */
  text: string;
}

const BLOCK_TAG_PATTERN = /^\[(결론|근거|확인사항)\]\s*/;

/** Pure - never throws. An untagged paragraph defaults to "evidence" (the strictest type) - fail-safe, not fail-open: a model that forgets to tag a paragraph gets the OLD strict behavior for it, never a silent pass. */
export function parseAnswerBlock(paragraph: string): ParsedAnswerBlock {
  const match = paragraph.match(BLOCK_TAG_PATTERN);
  if (!match) {
    return { type: "evidence", text: paragraph };
  }
  const tag = match[1] as "결론" | "근거" | "확인사항";
  const type: AnswerBlockType = tag === "결론" ? "conclusion" : tag === "확인사항" ? "action" : "evidence";
  return { type, text: paragraph.slice(match[0].length) };
}

/**
 * Validates ONE already-parsed block. "evidence" blocks (and, by
 * parseAnswerBlock()'s fail-safe default, any untagged block) require at
 * least one valid citation marker - identical strictness to
 * assertEveryParagraphHasCitation() above. "conclusion"/"action" blocks
 * never require one, but ANY marker they do contain must still resolve to
 * a citation actually supplied - a hallucinated/nonexistent marker is
 * rejected in every block type without exception.
 */
export function assertAnswerBlockGrounded(block: ParsedAnswerBlock, citations: readonly Citation[]): void {
  const markers = findCitationMarkers(block.text);
  const validMarkers = markers.filter((marker) =>
    citations.some(
      (citation) => citation.clauseReference === marker.clauseReference && citation.contractTitle === marker.contractTitle
    )
  );
  const hasHallucinatedMarker = markers.length > validMarkers.length;
  if (hasHallucinatedMarker) {
    throw new Error(`citation 표시가 실제 제공된 근거와 일치하지 않아 출력을 거부합니다: "${block.text.slice(0, 80)}"`);
  }
  if (block.type === "evidence" && validMarkers.length === 0) {
    throw new Error(`citation 표시가 없는 근거 문단이 있어 출력을 거부합니다: "${block.text.slice(0, 80)}"`);
  }
}

/**
 * Full-answer version of assertAnswerBlockGrounded() - splits on the same
 * paragraph boundary as assertEveryParagraphHasCitation() (blank line),
 * validates every block, and returns the TAG-STRIPPED text (never the raw
 * "[결론]"/"[근거]"/"[확인사항]" markup) - this is what ask-question.ts
 * persists/returns/streams to the caller. Same "citations must be
 * non-empty" precondition as assertEveryParagraphHasCitation() (the
 * hallucination guard must short-circuit before this is ever reached with
 * zero citations).
 */
export function assertAnswerGrounded(answerText: string, citations: readonly Citation[]): string {
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

  const strippedParagraphs: string[] = [];
  for (const paragraph of paragraphs) {
    const block = parseAnswerBlock(paragraph);
    assertAnswerBlockGrounded(block, citations);
    strippedParagraphs.push(block.text);
  }

  return strippedParagraphs.join("\n\n");
}
