import { describe, expect, it } from "vitest";

import { assertQuestionWithinBudget, MAX_QUESTION_LENGTH, QuestionTooLongError } from "@/domain/ai/context-budget";

describe("assertQuestionWithinBudget (Phase 12.2 §30)", () => {
  it("does not throw for a question within budget", () => {
    expect(() => assertQuestionWithinBudget("계약을 해지하려면 어떻게 해야 하나요?")).not.toThrow();
  });

  it("throws QuestionTooLongError for a question over the limit", () => {
    const tooLong = "가".repeat(MAX_QUESTION_LENGTH + 1);
    expect(() => assertQuestionWithinBudget(tooLong)).toThrow(QuestionTooLongError);
  });

  it("does not throw exactly at the boundary", () => {
    const exactly = "가".repeat(MAX_QUESTION_LENGTH);
    expect(() => assertQuestionWithinBudget(exactly)).not.toThrow();
  });
});
