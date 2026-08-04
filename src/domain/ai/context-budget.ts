import { MAX_EVIDENCE_LENGTH } from "./evidence-sentence";

/**
 * §Phase 12.2 Part E (§30 Context budget) - hard ceilings on what actually
 * reaches the LLM per request, independent of (and in addition to)
 * retrieval's own `topK`. These exist so a future `topK`/citation-count
 * change can never silently balloon prompt size/cost: `askQuestion()` /
 * `askQuestionStreaming()` (features/ai/server/ask-question.ts) truncate
 * `guard.strongCitations` to `CONTEXT_MAX_CLAUSES` right before building
 * the prompt, regardless of how many "strong" citations the hallucination
 * guard found. The original evidence text is never re-expanded past
 * `MAX_EVIDENCE_LENGTH` per clause (evidence-sentence.ts already enforces
 * that at the source), so the two constants together give a hard upper
 * bound on total context size.
 */
export const CONTEXT_MAX_CLAUSES = 8;
export const CONTEXT_MAX_TOTAL_EVIDENCE_CHARS = CONTEXT_MAX_CLAUSES * MAX_EVIDENCE_LENGTH;

/**
 * §30 - user question length cap. Applied before any retrieval/embedding
 * work begins (see ask-question.ts) so an oversized question is rejected
 * cheaply rather than after spending an embedding call on it.
 */
export const MAX_QUESTION_LENGTH = 2000;

export class QuestionTooLongError extends Error {
  constructor(public readonly length: number) {
    super(`질문이 너무 깁니다 (${length}자, 최대 ${MAX_QUESTION_LENGTH}자) - 더 짧게 다시 질문해 주세요.`);
    this.name = "QuestionTooLongError";
  }
}

/** Throws QuestionTooLongError if over budget - never silently truncates a user's own question (unlike citation truncation below, which is safe to do silently since it only drops the WEAKEST already-ranked evidence). */
export function assertQuestionWithinBudget(question: string): void {
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new QuestionTooLongError(question.length);
  }
}

export interface ContextBudgetResult<T> {
  kept: T[];
  truncated: boolean;
  droppedCount: number;
}

/**
 * Truncates an already-score-sorted citation list down to
 * `CONTEXT_MAX_CLAUSES`, keeping the highest-scored entries. Safe to do
 * silently (unlike the question-length cap) because the dropped items are
 * strictly the weakest-scored evidence, never evidence the caller
 * specifically asked for.
 */
export function truncateToContextBudget<T>(citations: readonly T[]): ContextBudgetResult<T> {
  if (citations.length <= CONTEXT_MAX_CLAUSES) {
    return { kept: [...citations], truncated: false, droppedCount: 0 };
  }
  return {
    kept: citations.slice(0, CONTEXT_MAX_CLAUSES),
    truncated: true,
    droppedCount: citations.length - CONTEXT_MAX_CLAUSES,
  };
}
