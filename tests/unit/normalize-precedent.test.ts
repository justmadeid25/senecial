import { describe, expect, it } from "vitest";

import { normalizePrecedentSource } from "@/domain/legal";
import type { PrecedentBodyFetchResult } from "@/domain/legal";

const fetchResult: PrecedentBodyFetchResult = {
  officialPrecedentId: "999888",
  caseName: "손해배상(기) 사건",
  caseNumber: "2020다12345",
  court: "대법원",
  decisionDate: "20210311",
  caseType: "민사",
  holdingSummary: "판시사항 요약",
  fullText: "주문: 원심판결을 파기하고, 사건을 서울고등법원에 환송한다.",
  sourceUrl: "https://www.law.go.kr/판례/999888",
};

describe("normalizePrecedentSource (Phase L1 §2/§4/§5)", () => {
  it("preserves caseNumber EXACTLY as returned by the official source", () => {
    const source = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    expect(source.caseNumber).toBe("2020다12345");
  });

  it("builds a citationLabel from court + caseNumber + formatted decisionDate only", () => {
    const source = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    expect(source.citationLabel).toBe("대법원 2020다12345 2021.03.11.");
  });

  it("never uses caseName for identity - only officialPrecedentId", () => {
    const source = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    expect(source.identity.externalId).toBe("999888");
    expect(source.identity.articleId).toBeNull();
  });

  it("degrades gracefully when caseNumber/decisionDate/court are all missing, without throwing", () => {
    const bare: PrecedentBodyFetchResult = { ...fetchResult, caseNumber: null, decisionDate: null, court: null };
    const source = normalizePrecedentSource({ fetchResult: bare, retrievedAt: new Date() });
    expect(source.citationLabel).toBe("출처 미상 판례");
    expect(source.caseNumber).toBeNull();
  });

  it("parses a malformed decisionDate as null rather than an invented date", () => {
    const malformed: PrecedentBodyFetchResult = { ...fetchResult, decisionDate: "not-a-date" };
    const source = normalizePrecedentSource({ fetchResult: malformed, retrievedAt: new Date() });
    expect(source.decisionDate).toBeNull();
  });

  it("is deterministic for identical input", () => {
    const first = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    const second = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    expect(first.contentHash).toBe(second.contentHash);
  });
});
