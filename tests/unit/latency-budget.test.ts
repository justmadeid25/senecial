import { describe, expect, it } from "vitest";

import { exceedsLatencyBudget, LATENCY_BUDGET_MS } from "@/domain/ai/latency-budget";

describe("exceedsLatencyBudget (Phase 12.2 §29)", () => {
  it("returns false when under budget", () => {
    expect(exceedsLatencyBudget("embedding", LATENCY_BUDGET_MS.embedding - 1, false)).toBe(false);
  });

  it("returns true when over budget for a real (non-development) provider", () => {
    expect(exceedsLatencyBudget("embedding", LATENCY_BUDGET_MS.embedding + 1, false)).toBe(true);
  });

  it("is a no-op (always false) for the development provider, regardless of duration - §29's own instruction not to mix dev/real provider metrics", () => {
    expect(exceedsLatencyBudget("llm", LATENCY_BUDGET_MS.llm * 100, true)).toBe(false);
  });

  it("enforces distinct budgets per operation", () => {
    expect(LATENCY_BUDGET_MS.vectorSearch).toBeLessThan(LATENCY_BUDGET_MS.embedding);
    expect(exceedsLatencyBudget("vectorSearch", LATENCY_BUDGET_MS.vectorSearch + 1, false)).toBe(true);
    expect(exceedsLatencyBudget("hybridMerge", LATENCY_BUDGET_MS.vectorSearch + 1, false)).toBe(
      LATENCY_BUDGET_MS.vectorSearch + 1 > LATENCY_BUDGET_MS.hybridMerge
    );
  });

  it("boundary value (exactly at budget) does not count as exceeding", () => {
    expect(exceedsLatencyBudget("retrieval", LATENCY_BUDGET_MS.retrieval, false)).toBe(false);
  });
});
