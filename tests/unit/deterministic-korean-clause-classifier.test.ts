import { describe, expect, it } from "vitest";

import type { ClauseType } from "@/generated/prisma/enums";
import { DeterministicKoreanClauseClassifier } from "@/server/services/clauses/deterministic-korean-clause-classifier";

const ALL_TYPES: ClauseType[] = [
  "DEFINITIONS",
  "TERM",
  "TERMINATION",
  "PAYMENT",
  "CONFIDENTIALITY",
  "LIABILITY",
  "LIMITATION_OF_LIABILITY",
  "INTELLECTUAL_PROPERTY",
  "AUTO_RENEWAL",
  "FORCE_MAJEURE",
  "GOVERNING_LAW",
  "JURISDICTION",
  "ASSIGNMENT",
  "UNKNOWN",
];

describe("DeterministicKoreanClauseClassifier", () => {
  const classifier = new DeterministicKoreanClauseClassifier();

  it("classifies a clause containing 계약기간 as TERM", async () => {
    const result = await classifier.classify({
      clauseText: "본 계약의 계약기간은 1년으로 한다.",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("TERM");
    expect(result.matchedSignals).toContain("keyword:계약기간");
  });

  it("classifies a clause containing 비밀 as CONFIDENTIALITY", async () => {
    const result = await classifier.classify({
      clauseText: "양 당사자는 비밀 정보를 제3자에게 누설하지 않는다.",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("CONFIDENTIALITY");
  });

  it("classifies a clause containing 준거법 as GOVERNING_LAW", async () => {
    const result = await classifier.classify({
      clauseText: "본 계약은 대한민국 준거법에 따른다.",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("GOVERNING_LAW");
  });

  it("breaks a tied keyword-match count by rule declaration order", async () => {
    // Keyword matching is presence-based (not occurrence-counted), so both
    // LIMITATION_OF_LIABILITY ("책임 한도") and LIABILITY ("손해배상") match
    // exactly one keyword each here - a tie. LIMITATION_OF_LIABILITY is
    // declared earlier in CLASSIFICATION_RULES, so it wins the tie-break.
    const result = await classifier.classify({
      clauseText: "책임 한도 내에서 손해배상 책임을 진다.",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("LIMITATION_OF_LIABILITY");
  });

  it("falls back to UNKNOWN when no rule matches, rather than guessing", async () => {
    const result = await classifier.classify({
      clauseText: "본 조항은 특별한 의미가 없는 예시 문장이다.",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("UNKNOWN");
    expect(result.matchedSignals).toEqual([]);
    expect(result.confidence).toBeUndefined();
  });

  it("only matches types included in allowedTypes", async () => {
    const result = await classifier.classify({
      clauseText: "본 계약의 계약기간은 1년으로 한다.",
      allowedTypes: ["UNKNOWN"],
      locale: "ko-KR",
    });
    expect(result.suggestedType).toBe("UNKNOWN");
  });

  it("never returns a confidence outside [0, 1]", async () => {
    const result = await classifier.classify({
      clauseText: "계약기간 준거법 관할법원 비밀 손해배상",
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    expect(result.confidence).toBeDefined();
    expect(result.confidence!).toBeGreaterThanOrEqual(0);
    expect(result.confidence!).toBeLessThanOrEqual(1);
  });

  it("matchedSignals contains only short rule-name/keyword strings, never the full clause text", async () => {
    const longText = "계약기간 " + "x".repeat(1000);
    const result = await classifier.classify({
      clauseText: longText,
      allowedTypes: ALL_TYPES,
      locale: "ko-KR",
    });
    for (const signal of result.matchedSignals) {
      expect(signal.length).toBeLessThan(50);
    }
  });
});
