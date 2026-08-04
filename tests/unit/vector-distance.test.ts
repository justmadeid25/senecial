import { describe, expect, it } from "vitest";

import { cosineDistanceToSimilarity, cosineSimilarityToDistance } from "@/domain/ai/vector-distance";
import { cosineSimilarity } from "@/domain/ai/cosine-similarity";

describe("cosine distance <-> similarity conversion (Phase 12.1 §20)", () => {
  it("converts a distance of 0 (identical vectors) to a similarity of 1", () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
  });
  it("converts a distance of 1 (orthogonal vectors) to a similarity of 0", () => {
    expect(cosineDistanceToSimilarity(1)).toBe(0);
  });
  it("is the exact inverse of cosineSimilarityToDistance", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      expect(cosineDistanceToSimilarity(cosineSimilarityToDistance(value))).toBeCloseTo(value, 10);
    }
  });

  it("matches the real pgvector install probe's empirically-observed values ([1,0,0] vs [0.9,0.1,0] ~ distance 0.0061)", () => {
    // Same three vectors used in the real `<=>` probe during installation
    // (see docs/operations/ai-platform.md) - the conversion must agree
    // with the application-side cosineSimilarity() computation for the
    // same pair, since hybrid search treats them as interchangeable.
    const a = [1, 0, 0];
    const b = [0.9, 0.1, 0];
    const applicationSimilarity = cosineSimilarity(a, b);
    const pgvectorObservedDistance = 0.006116251198662548;
    expect(cosineDistanceToSimilarity(pgvectorObservedDistance)).toBeCloseTo(applicationSimilarity, 6);
  });
});
