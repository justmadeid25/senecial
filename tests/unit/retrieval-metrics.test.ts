import { describe, expect, it } from "vitest";

import {
  hitAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "@/domain/ai/evaluation/retrieval-metrics";

describe("retrieval-metrics (Phase 12 Part L §Evaluation)", () => {
  describe("recallAtK", () => {
    it("is 1 when every relevant id is found within K", () => {
      expect(recallAtK(["a", "b", "c"], ["b"], 3)).toBe(1);
    });
    it("is a fraction when only some relevant ids are found", () => {
      expect(recallAtK(["a", "b", "c"], ["b", "z"], 3)).toBe(0.5);
    });
    it("is 0 when no relevant id is found", () => {
      expect(recallAtK(["a", "b", "c"], ["x", "y"], 3)).toBe(0);
    });
    it("ignores results beyond K", () => {
      expect(recallAtK(["a", "b", "c", "d"], ["d"], 2)).toBe(0);
    });
    it("is 1 by convention when there are no relevant ids at all", () => {
      expect(recallAtK(["a", "b"], [], 3)).toBe(1);
    });
  });

  describe("precisionAtK", () => {
    it("computes the fraction of top-K results that are relevant", () => {
      expect(precisionAtK(["a", "b", "c"], ["a", "c"], 3)).toBeCloseTo(2 / 3);
    });
    it("is 0 for an empty retrieved list", () => {
      expect(precisionAtK([], ["a"], 3)).toBe(0);
    });
    it("only considers the first K retrieved results", () => {
      expect(precisionAtK(["a", "b", "c"], ["c"], 1)).toBe(0);
    });
  });

  describe("reciprocalRank", () => {
    it("is 1 when the first result is relevant", () => {
      expect(reciprocalRank(["a", "b"], ["a"])).toBe(1);
    });
    it("is 1/2 when the first relevant result is at rank 2", () => {
      expect(reciprocalRank(["a", "b", "c"], ["b"])).toBe(0.5);
    });
    it("is 0 when no result is relevant", () => {
      expect(reciprocalRank(["a", "b"], ["z"])).toBe(0);
    });
  });

  describe("ndcgAtK", () => {
    it("is 1 for a perfectly-ordered result set", () => {
      expect(ndcgAtK(["a", "b"], ["a", "b"], 2)).toBeCloseTo(1);
    });
    it("penalizes a relevant result ranked lower than an irrelevant one", () => {
      const perfect = ndcgAtK(["a", "x"], ["a"], 2);
      const inverted = ndcgAtK(["x", "a"], ["a"], 2);
      expect(inverted).toBeLessThan(perfect);
    });
    it("is 0 when there are no relevant results in range", () => {
      expect(ndcgAtK(["x", "y"], ["a"], 2)).toBe(0);
    });
  });

  describe("hitAtK", () => {
    it("is true when any relevant id appears in the top-K", () => {
      expect(hitAtK(["a", "b", "c"], ["c"], 3)).toBe(true);
    });
    it("is false when no relevant id appears within K", () => {
      expect(hitAtK(["a", "b", "c"], ["c"], 2)).toBe(false);
    });
  });
});
