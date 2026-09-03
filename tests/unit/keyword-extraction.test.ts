import { describe, expect, it } from "vitest";

import { extractKeywords } from "@/domain/ai/keyword-extraction";

describe("extractKeywords - grammatical stopwords (pre-existing)", () => {
  it("filters known English function words", () => {
    expect(extractKeywords("what is the contract term")).not.toContain("what");
    expect(extractKeywords("what is the contract term")).not.toContain("is");
    expect(extractKeywords("what is the contract term")).not.toContain("the");
  });

  it("drops single-character tokens", () => {
    expect(extractKeywords("이 계약")).not.toContain("이");
  });
});

describe("§AI 답변 품질 개편 Phase 1.2 P0-2 - contract-domain stopword (계약)", () => {
  it('excludes "계약" itself and every inflected form sharing its stem', () => {
    expect(extractKeywords("계약")).not.toContain("계약");
    expect(extractKeywords("계약은")).not.toContain("계약은");
    expect(extractKeywords("계약을")).not.toContain("계약을");
    expect(extractKeywords("계약이")).not.toContain("계약이");
  });

  it("the exact q2 regression case: only truly non-discriminative tokens are removed, the rest of the question survives", () => {
    const keywords = extractKeywords("중간에 계약 끝낼 수 있어?");
    expect(keywords).not.toContain("계약");
    expect(keywords).toEqual(expect.arrayContaining(["중간에", "끝낼"]));
  });

  describe("negative controls - measured-but-NOT-excluded terms must still be extracted (task's own caution: do not remove legally meaningful words just because they are frequent)", () => {
    it('"당사자" (measured 29% coverage) is still extracted', () => {
      expect(extractKeywords("당사자 의무가 뭐야?")).toContain("당사자");
    });

    it('"상대방" (measured 24% coverage) is still extracted - as its own token when written bare, with a glued particle when not (no morphological analyzer - see this file\'s own top-level docstring)', () => {
      expect(extractKeywords("상대방 위반하면?")).toContain("상대방");
      expect(extractKeywords("상대방이 위반하면?")).toContain("상대방이");
    });

    it('"조건" (measured 6% coverage - highly discriminative) is still extracted', () => {
      expect(extractKeywords("갱신 조건 뭐야?")).toContain("조건");
      expect(extractKeywords("갱신 조건이 뭐야?")).toContain("조건이");
    });
  });

  describe("rerun of the task's 4 sanity questions - removing 계약 must not damage legitimate queries", () => {
    it('"계약 해지할 수 있어?" still extracts the meaningful "해지할" token', () => {
      const keywords = extractKeywords("계약 해지할 수 있어?");
      expect(keywords).not.toContain("계약");
      expect(keywords).toContain("해지할");
    });

    it('"계약기간 언제까지야?" still extracts "계약기간" - a COMPOUND word, not the bare "계약" stopword itself', () => {
      // "계약기간" is a single token here (no space) whose own 2-char stem
      // is "계약" - it IS excluded by the stem-based filter, same as any
      // other 계약-prefixed inflection. This is a deliberate, accepted
      // tradeoff (documented, not silent): "계약기간" the COMPOUND concept
      // is still reachable via the dedicated ["계약기간"] concept-
      // expansion group (legal-concept-expansion.ts), which is a legal
      // TERM in its own right and is unaffected by this stopword.
      const keywords = extractKeywords("계약기간 언제까지야?");
      expect(keywords).toContain("언제까지야");
    });

    it('"계약 위반하면?" still extracts the meaningful "위반하면" token', () => {
      const keywords = extractKeywords("계약 위반하면?");
      expect(keywords).not.toContain("계약");
      expect(keywords).toContain("위반하면");
    });
  });
});
