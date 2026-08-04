import { describe, expect, it } from "vitest";

import { mergeScores, rerank } from "@/domain/ai/hybrid-search-scoring";

describe("mergeScores (Phase 12 Part B §Score Merge)", () => {
  it("weights keyword score higher than vector score (0.6 vs 0.4)", () => {
    const [pureVector] = mergeScores([{ contractClauseId: "a", keywordScore: 0, vectorScore: 1 }]);
    const [pureKeyword] = mergeScores([{ contractClauseId: "b", keywordScore: 1, vectorScore: 0 }]);
    expect(pureKeyword!.score).toBeGreaterThan(pureVector!.score);
  });

  it("clamps a negative cosine score to 0 rather than subtracting from the keyword score", () => {
    const [result] = mergeScores([{ contractClauseId: "a", keywordScore: 1, vectorScore: -0.8 }]);
    expect(result!.score).toBeCloseTo(0.6, 5); // 0.6*1 + 0.4*0
  });

  it("a clause matching both legs scores higher than one matching only one leg", () => {
    const [both] = mergeScores([{ contractClauseId: "a", keywordScore: 0.5, vectorScore: 0.5 }]);
    const [oneOnly] = mergeScores([{ contractClauseId: "b", keywordScore: 0.5, vectorScore: 0 }]);
    expect(both!.score).toBeGreaterThan(oneOnly!.score);
  });
});

describe("rerank (Phase 12 Part B §Rerank)", () => {
  it("sorts by score descending", () => {
    const merged = mergeScores([
      { contractClauseId: "low", keywordScore: 0.1, vectorScore: 0.1 },
      { contractClauseId: "high", keywordScore: 0.9, vectorScore: 0.9 },
    ]);
    const result = rerank(merged, new Set());
    expect(result.map((r) => r.contractClauseId)).toEqual(["high", "low"]);
  });

  it("applies an exact-phrase bonus that can change the final order", () => {
    const merged = mergeScores([
      { contractClauseId: "slightly-better", keywordScore: 0.5, vectorScore: 0.5 },
      { contractClauseId: "exact-phrase", keywordScore: 0.45, vectorScore: 0.45 },
    ]);
    const withoutBonus = rerank(merged, new Set());
    expect(withoutBonus[0]!.contractClauseId).toBe("slightly-better");

    const withBonus = rerank(merged, new Set(["exact-phrase"]));
    expect(withBonus[0]!.contractClauseId).toBe("exact-phrase");
  });
});
