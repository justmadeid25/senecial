import { describe, expect, it } from "vitest";

import {
  assertQuestionWithinBudget,
  CONTEXT_MAX_CLAUSES,
  MAX_QUESTION_LENGTH,
  QuestionTooLongError,
  truncateToContextBudget,
} from "@/domain/ai/context-budget";

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

describe("truncateToContextBudget (Phase 12.2 §30)", () => {
  it("keeps everything and reports no truncation when under the limit", () => {
    const items = Array.from({ length: CONTEXT_MAX_CLAUSES - 1 }, (_, i) => i);
    const result = truncateToContextBudget(items);
    expect(result.truncated).toBe(false);
    expect(result.kept).toEqual(items);
    expect(result.droppedCount).toBe(0);
  });

  it("truncates to CONTEXT_MAX_CLAUSES, keeping the highest-ranked (first) items, when over the limit", () => {
    const items = Array.from({ length: CONTEXT_MAX_CLAUSES + 5 }, (_, i) => i);
    const result = truncateToContextBudget(items);
    expect(result.truncated).toBe(true);
    expect(result.kept).toHaveLength(CONTEXT_MAX_CLAUSES);
    expect(result.kept).toEqual(items.slice(0, CONTEXT_MAX_CLAUSES));
    expect(result.droppedCount).toBe(5);
  });

  it("does not mutate the input array", () => {
    const items = Array.from({ length: CONTEXT_MAX_CLAUSES + 2 }, (_, i) => i);
    const original = [...items];
    truncateToContextBudget(items);
    expect(items).toEqual(original);
  });
});
