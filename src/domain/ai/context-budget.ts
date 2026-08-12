/**
 * §30 - user question length cap. Applied before any retrieval/embedding
 * work begins (see ask-question.ts) so an oversized question is rejected
 * cheaply rather than after spending an embedding call on it.
 *
 * §Phase 14.1 §5 - the evidence-side budget (formerly a fixed
 * `CONTEXT_MAX_CLAUSES` count here) now lives in context-token-budget.ts as
 * a real token budget - see packCitationsWithinTokenBudget().
 */
export const MAX_QUESTION_LENGTH = 2000;

export class QuestionTooLongError extends Error {
  constructor(public readonly length: number) {
    super(`질문이 너무 깁니다 (${length}자, 최대 ${MAX_QUESTION_LENGTH}자) - 더 짧게 다시 질문해 주세요.`);
    this.name = "QuestionTooLongError";
  }
}

/** Throws QuestionTooLongError if over budget - never silently truncates a user's own question. */
export function assertQuestionWithinBudget(question: string): void {
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new QuestionTooLongError(question.length);
  }
}
