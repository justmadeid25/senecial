import { describe, expect, it } from "vitest";

import {
  assertValidNativeVector,
  InvalidVectorError,
  isFiniteVector,
  serializeVectorForPg,
} from "@/domain/ai/vector-validation";

describe("isFiniteVector (Phase 12.1 §20)", () => {
  it("is true for an all-finite vector", () => {
    expect(isFiniteVector([1, -0.5, 0, 3.14])).toBe(true);
  });
  it("is false if any component is NaN", () => {
    expect(isFiniteVector([1, NaN, 3])).toBe(false);
  });
  it("is false if any component is Infinity or -Infinity", () => {
    expect(isFiniteVector([1, Infinity, 3])).toBe(false);
    expect(isFiniteVector([1, -Infinity, 3])).toBe(false);
  });
  it("is true for an empty vector (vacuous)", () => {
    expect(isFiniteVector([])).toBe(true);
  });
});

describe("assertValidNativeVector (Phase 12.1 §20 - dimension + finite-number validation)", () => {
  it("does not throw for a correctly-dimensioned, all-finite vector", () => {
    expect(() => assertValidNativeVector([1, 2, 3], 3)).not.toThrow();
  });

  it("throws InvalidVectorError with reason DIMENSION_MISMATCH for a length mismatch", () => {
    try {
      assertValidNativeVector([1, 2], 3);
      expect.fail("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidVectorError);
      expect((error as InvalidVectorError).reason).toBe("DIMENSION_MISMATCH");
    }
  });

  it("throws InvalidVectorError with reason NON_FINITE_VALUE for NaN", () => {
    try {
      assertValidNativeVector([1, NaN, 3], 3);
      expect.fail("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidVectorError);
      expect((error as InvalidVectorError).reason).toBe("NON_FINITE_VALUE");
    }
  });

  it("throws InvalidVectorError with reason NON_FINITE_VALUE for Infinity", () => {
    expect(() => assertValidNativeVector([1, Infinity, 3], 3)).toThrow(InvalidVectorError);
  });

  it("checks dimension before finiteness (a too-short vector never gets scanned for NaN)", () => {
    try {
      assertValidNativeVector([1, NaN], 3);
      expect.fail("expected to throw");
    } catch (error) {
      expect((error as InvalidVectorError).reason).toBe("DIMENSION_MISMATCH");
    }
  });
});

describe("serializeVectorForPg (Phase 12.1 §20 - vector serialization)", () => {
  it("produces pgvector's bracketed text format", () => {
    expect(serializeVectorForPg([1, 2.5, -3], 3)).toBe("[1,2.5,-3]");
  });

  it("throws (never silently serializes) an invalid vector", () => {
    expect(() => serializeVectorForPg([1, NaN], 2)).toThrow(InvalidVectorError);
    expect(() => serializeVectorForPg([1, 2, 3], 2)).toThrow(InvalidVectorError);
  });

  it("round-trips through JSON-like bracket parsing for a realistic embedding-sized vector", () => {
    const vector = Array.from({ length: 256 }, (_, i) => Math.sin(i) * 0.01);
    const serialized = serializeVectorForPg(vector, 256);
    const parsed = serialized
      .slice(1, -1)
      .split(",")
      .map(Number);
    expect(parsed).toHaveLength(256);
    for (let i = 0; i < 256; i += 1) {
      expect(parsed[i]).toBeCloseTo(vector[i]!, 10);
    }
  });
});
