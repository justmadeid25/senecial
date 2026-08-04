import { describe, expect, it } from "vitest";

import { detectClauseNumberLine } from "@/domain/clauses/clause-number-patterns";

describe("detectClauseNumberLine - article/paragraph/sub-item patterns", () => {
  it("detects 제N조 with a title", () => {
    expect(detectClauseNumberLine("제1조(목적)")).toEqual({
      clauseNumber: "제1조",
      title: "목적",
      depth: 0,
      matchedLength: "제1조(목적)".length,
    });
  });

  it("detects 제 N 조 with spacing", () => {
    const result = detectClauseNumberLine("제 1 조 목적");
    expect(result?.clauseNumber).toBe("제1조");
    expect(result?.depth).toBe(0);
  });

  it("detects 제N조 without a parenthesized title", () => {
    const result = detectClauseNumberLine("제2조 계약기간");
    expect(result?.clauseNumber).toBe("제2조");
    expect(result?.title).toBeUndefined();
    expect(result?.depth).toBe(0);
  });

  it("detects 제N항 as depth 1", () => {
    expect(detectClauseNumberLine("제1항 내용")?.depth).toBe(1);
  });

  it("detects circled numbers (①②...) as depth 1", () => {
    expect(detectClauseNumberLine("① 첫 번째 항목")).toMatchObject({
      clauseNumber: "①",
      depth: 1,
    });
  });

  it("detects '1.' / '1)' / '(1)' as depth 1", () => {
    expect(detectClauseNumberLine("1. 항목")).toMatchObject({ depth: 1 });
    expect(detectClauseNumberLine("1) 항목")).toMatchObject({ depth: 1 });
    expect(detectClauseNumberLine("(1) 항목")).toMatchObject({ depth: 1 });
  });

  it("detects 가./나. as depth 2", () => {
    expect(detectClauseNumberLine("가. 세부 항목")).toMatchObject({
      clauseNumber: "가.",
      depth: 2,
    });
  });

  it("does not treat a mid-sentence number as a clause boundary", () => {
    expect(detectClauseNumberLine("이 조항은 1. 항목이 아닙니다")).toBeNull();
  });

  it("returns null for a plain sentence", () => {
    expect(detectClauseNumberLine("본 계약은 임대인과 임차인 간의 계약이다.")).toBeNull();
  });
});

describe("detectClauseNumberLine - false-positive exclusion", () => {
  it("does not mistake a dot-separated date for a '1.' clause number", () => {
    expect(detectClauseNumberLine("2026. 8. 1.")).toBeNull();
  });

  it("does not mistake an ISO date for a clause number", () => {
    expect(detectClauseNumberLine("2026-08-01")).toBeNull();
  });

  it("does not mistake a Korean-language date for a clause number", () => {
    expect(detectClauseNumberLine("2026년 8월 1일부터 계약이 시작된다")).toBeNull();
  });

  it("does not mistake an amount line for a clause number", () => {
    expect(detectClauseNumberLine("8,000,000원을 지급한다")).toBeNull();
  });

  it("does not mistake a contract-number line for a clause number", () => {
    expect(detectClauseNumberLine("SEED-LEASE-001")).toBeNull();
  });

  it("does not confuse a decimal number with a clause number", () => {
    expect(detectClauseNumberLine("12.5%의 이자율이 적용된다")).toBeNull();
  });
});
