import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "@/domain/ai/cosine-similarity";
import { computeHashingTrickEmbedding, HASHING_TRICK_DEFAULT_DIMENSION } from "@/domain/ai/hashing-trick-embedding";

describe("computeHashingTrickEmbedding (Phase 12 Part A - real, not a placeholder)", () => {
  it("is deterministic - the exact same text always produces the byte-identical vector", () => {
    const text = "계약 해지는 서면으로 통지해야 한다.";
    const first = computeHashingTrickEmbedding(text);
    const second = computeHashingTrickEmbedding(text);
    expect(first).toEqual(second);
  });

  it("produces a vector of the requested dimension", () => {
    expect(computeHashingTrickEmbedding("test", 64)).toHaveLength(64);
    expect(computeHashingTrickEmbedding("test")).toHaveLength(HASHING_TRICK_DEFAULT_DIMENSION);
  });

  it("L2-normalizes the output (norm ≈ 1 for any non-empty text)", () => {
    const vector = computeHashingTrickEmbedding("계약 해지 조항입니다.");
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("returns an all-zero vector for empty text", () => {
    const vector = computeHashingTrickEmbedding("");
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  it("assigns genuinely higher similarity to related texts than to unrelated ones - this is the actual correctness claim, not just determinism", () => {
    const base = "계약 해지는 서면으로 상대방에게 통지해야 한다.";
    const related = "계약 해지 시 서면으로 통지하여야 한다.";
    const unrelated = "본 계약의 준거법은 대한민국 법률로 한다.";

    const baseVec = computeHashingTrickEmbedding(base);
    const relatedVec = computeHashingTrickEmbedding(related);
    const unrelatedVec = computeHashingTrickEmbedding(unrelated);

    const relatedScore = cosineSimilarity(baseVec, relatedVec);
    const unrelatedScore = cosineSimilarity(baseVec, unrelatedVec);

    expect(relatedScore).toBeGreaterThan(unrelatedScore);
  });

  it("an identical text against itself has cosine similarity 1", () => {
    const vector = computeHashingTrickEmbedding("동일한 텍스트");
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1, 5);
  });
});

describe("cosineSimilarity (Phase 12 Part B)", () => {
  it("throws on mismatched dimensions", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/벡터 차원/);
  });

  it("returns 0 (never NaN) for a zero vector", () => {
    const zero = new Array(8).fill(0);
    const other = computeHashingTrickEmbedding("아무 텍스트", 8);
    expect(cosineSimilarity(zero, other)).toBe(0);
    expect(Number.isNaN(cosineSimilarity(zero, other))).toBe(false);
  });

  it("orthogonal-ish unit vectors score near 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("opposite vectors score -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });
});
