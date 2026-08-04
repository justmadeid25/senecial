import { describe, expect, it } from "vitest";

import {
  compareClauseToStandard,
  computeLineSimilarity,
  diffLines,
} from "@/domain/clauses/clause-diff";

describe("diffLines / computeLineSimilarity", () => {
  it("reports identical text as fully similar with no added/removed lines", () => {
    const text = "동일한 조항 내용입니다.";
    const segments = diffLines(text, text);
    expect(segments.every((s) => s.type === "same")).toBe(true);
    expect(computeLineSimilarity(text, text)).toBe(1);
  });

  it("reports an added line present only in the clause", () => {
    const segments = diffLines("표준 문구\n계약에만 있는 문구", "표준 문구");
    expect(segments.some((s) => s.type === "added" && s.text === "계약에만 있는 문구")).toBe(true);
  });

  it("reports a removed line present only in the standard", () => {
    const segments = diffLines("표준 문구", "표준 문구\n기준에만 있는 문구");
    expect(segments.some((s) => s.type === "removed" && s.text === "기준에만 있는 문구")).toBe(
      true
    );
  });

  it("similarity is 0 for completely disjoint single-line text", () => {
    expect(computeLineSimilarity("완전히 다른 문구 A", "전혀 관계없는 문구 B")).toBe(0);
  });
});

describe("compareClauseToStandard", () => {
  it("marks identical clause/standard text as identical", () => {
    const text = "본 계약은 손해배상 책임을 진다.";
    const result = compareClauseToStandard(text, text);
    expect(result.identical).toBe(true);
  });

  it("detects a numeric difference between clause and standard", () => {
    const result = compareClauseToStandard(
      "해지 통보는 30일 전에 하여야 한다.",
      "해지 통보는 60일 전에 하여야 한다."
    );
    expect(result.numberDifference.onlyInClause).toContain("30");
    expect(result.numberDifference.onlyInStandard).toContain("60");
  });

  it("detects a date difference between clause and standard", () => {
    const result = compareClauseToStandard(
      "계약기간은 2026-08-01부터 시작한다.",
      "계약기간은 2027-01-01부터 시작한다."
    );
    expect(result.dateDifference.onlyInClause.length).toBeGreaterThan(0);
    expect(result.dateDifference.onlyInStandard.length).toBeGreaterThan(0);
  });

  it("detects an amount difference between clause and standard", () => {
    const result = compareClauseToStandard("위약금은 1,000,000원으로 한다.", "위약금은 5,000,000원으로 한다.");
    expect(result.amountDifference.onlyInClause.length).toBeGreaterThan(0);
    expect(result.amountDifference.onlyInStandard.length).toBeGreaterThan(0);
  });

  it("never mutates or reads a database - it is a pure string function", () => {
    // Purity check: calling twice with the same input yields deep-equal output.
    const a = compareClauseToStandard("동일 문구", "동일 문구");
    const b = compareClauseToStandard("동일 문구", "동일 문구");
    expect(a).toEqual(b);
  });

  it("returns a similarity score between 0 and 1", () => {
    const result = compareClauseToStandard("일부만 같은 문구 A", "일부만 같은 문구 B");
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });
});
