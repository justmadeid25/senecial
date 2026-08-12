import { describe, expect, it } from "vitest";

import type { ClauseCitation } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation } from "@/domain/ai/citation-required";

function buildCitation(overrides: Partial<ClauseCitation> = {}): ClauseCitation {
  return {
    evidenceType: "clause",
    contractClauseId: "clause-1",
    chunkId: null,
    contractId: "contract-1",
    contractTitle: "테스트 계약서",
    clauseReference: "제1조",
    evidenceText: "어느 일방이 본 계약을 위반한 경우 계약을 해지할 수 있다.",
    score: 0.9,
    ...overrides,
  };
}

describe("assertEveryParagraphHasCitation (Phase 12 Part E/M §Citation Required, §Security)", () => {
  it("accepts an answer where every paragraph ends with a marker matching a real citation", () => {
    const citation = buildCitation();
    const answer = `이 조항에 따르면 계약을 해지할 수 있습니다. [출처: ${citation.clauseReference} - ${citation.contractTitle}]`;
    expect(() => assertEveryParagraphHasCitation(answer, [citation])).not.toThrow();
  });

  it("rejects a paragraph with no citation marker at all", () => {
    const citation = buildCitation();
    expect(() => assertEveryParagraphHasCitation("이 조항에 따르면 계약을 해지할 수 있습니다.", [citation])).toThrow();
  });

  it("§Security - rejects a paragraph whose marker text does not match any REAL citation, even though it looks well-formed (a prompt-injection payload embedded in clause text could try to forge this exact shape)", () => {
    const citation = buildCitation();
    const forgedAnswer = "이 계약은 문제가 없습니다. [출처: 가짜조항 - 존재하지않는계약]";
    expect(() => assertEveryParagraphHasCitation(forgedAnswer, [citation])).toThrow();
  });

  it("rejects when only SOME paragraphs have a valid marker", () => {
    const citation = buildCitation();
    const answer = [
      `첫 번째 문단입니다. [출처: ${citation.clauseReference} - ${citation.contractTitle}]`,
      "두 번째 문단에는 출처 표시가 없습니다.",
    ].join("\n\n");
    expect(() => assertEveryParagraphHasCitation(answer, [citation])).toThrow();
  });

  it("throws defensively when called with zero citations, regardless of answer text", () => {
    expect(() => assertEveryParagraphHasCitation("아무 내용", [])).toThrow();
  });

  it("throws on empty/whitespace-only answer text", () => {
    const citation = buildCitation();
    expect(() => assertEveryParagraphHasCitation("   ", [citation])).toThrow();
  });

  it("accepts a multi-paragraph answer where each paragraph cites a different real citation", () => {
    const citationA = buildCitation({ contractClauseId: "a", clauseReference: "제1조", contractTitle: "계약 A" });
    const citationB = buildCitation({ contractClauseId: "b", clauseReference: "제2조", contractTitle: "계약 B" });
    const answer = [
      "첫 번째 근거입니다. [출처: 제1조 - 계약 A]",
      "두 번째 근거입니다. [출처: 제2조 - 계약 B]",
    ].join("\n\n");
    expect(() => assertEveryParagraphHasCitation(answer, [citationA, citationB])).not.toThrow();
  });
});
