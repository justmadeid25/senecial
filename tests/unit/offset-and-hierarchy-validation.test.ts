import { describe, expect, it } from "vitest";

import {
  hasHierarchyCycle,
  isValidParentReference,
} from "@/domain/clauses/hierarchy-validation";
import { isOffsetRangeValid } from "@/domain/clauses/offset-validation";

describe("isOffsetRangeValid", () => {
  const documentText = "제1조 목적\n본 계약은 목적을 정한다.";

  it("accepts an offset range that is an exact substring match", () => {
    const expected = "본 계약은 목적을 정한다.";
    const start = documentText.indexOf(expected);
    expect(isOffsetRangeValid(documentText, start, start + expected.length, expected)).toBe(true);
  });

  it("rejects an offset range whose slice does not match the expected text", () => {
    expect(isOffsetRangeValid(documentText, 0, 5, "다른 문구")).toBe(false);
  });

  it("rejects a negative startOffset", () => {
    expect(isOffsetRangeValid(documentText, -1, 5, documentText.slice(0, 5))).toBe(false);
  });

  it("rejects an endOffset beyond the document length", () => {
    expect(isOffsetRangeValid(documentText, 0, documentText.length + 10, documentText)).toBe(
      false
    );
  });

  it("rejects startOffset >= endOffset", () => {
    expect(isOffsetRangeValid(documentText, 5, 5, "")).toBe(false);
  });

  it("rejects non-integer offsets", () => {
    expect(isOffsetRangeValid(documentText, 0.5, 5, documentText.slice(0, 5))).toBe(false);
  });
});

describe("isValidParentReference", () => {
  it("accepts a node with no parent", () => {
    expect(isValidParentReference({ orderIndex: 0 }, new Set([0]))).toBe(true);
  });

  it("accepts a parent that exists in the set and differs from the node itself", () => {
    expect(isValidParentReference({ orderIndex: 1, parentOrderIndex: 0 }, new Set([0, 1]))).toBe(
      true
    );
  });

  it("rejects a node that references itself as parent", () => {
    expect(isValidParentReference({ orderIndex: 0, parentOrderIndex: 0 }, new Set([0]))).toBe(
      false
    );
  });

  it("rejects a parent reference to a non-existent orderIndex", () => {
    expect(isValidParentReference({ orderIndex: 1, parentOrderIndex: 99 }, new Set([0, 1]))).toBe(
      false
    );
  });
});

describe("hasHierarchyCycle", () => {
  it("returns false for a valid tree", () => {
    const nodes = [
      { orderIndex: 0 },
      { orderIndex: 1, parentOrderIndex: 0 },
      { orderIndex: 2, parentOrderIndex: 1 },
    ];
    expect(hasHierarchyCycle(nodes)).toBe(false);
  });

  it("returns true for a direct two-node cycle (A -> B -> A)", () => {
    const nodes = [
      { orderIndex: 0, parentOrderIndex: 1 },
      { orderIndex: 1, parentOrderIndex: 0 },
    ];
    expect(hasHierarchyCycle(nodes)).toBe(true);
  });

  it("returns true for a longer cycle (A -> B -> C -> A)", () => {
    const nodes = [
      { orderIndex: 0, parentOrderIndex: 2 },
      { orderIndex: 1, parentOrderIndex: 0 },
      { orderIndex: 2, parentOrderIndex: 1 },
    ];
    expect(hasHierarchyCycle(nodes)).toBe(true);
  });

  it("returns false for disconnected flat nodes", () => {
    const nodes = [{ orderIndex: 0 }, { orderIndex: 1 }, { orderIndex: 2 }];
    expect(hasHierarchyCycle(nodes)).toBe(false);
  });
});
