import { describe, expect, it } from "vitest";

import { AiGroundingError, GROUNDING_REASONS } from "@/domain/ai/ai-stream-error";
import type { ClauseCitation } from "@/domain/ai/citation";
import {
  ANSWER_BLOCK_TAGS,
  assertAnswerBlockGrounded,
  assertAnswerGrounded,
  assertEveryParagraphHasCitation,
  parseAnswerBlock,
} from "@/domain/ai/citation-required";

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

describe("parseAnswerBlock (§AI 답변 품질 개편 P0-4 - block-aware validation)", () => {
  it("recognizes each of the three closed-set tags and strips them from the returned text", () => {
    expect(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.conclusion} 결론 내용입니다.`)).toEqual({
      type: "conclusion",
      text: "결론 내용입니다.",
    });
    expect(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.evidence} 근거 내용입니다.`)).toEqual({
      type: "evidence",
      text: "근거 내용입니다.",
    });
    expect(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.action} 확인사항 내용입니다.`)).toEqual({
      type: "action",
      text: "확인사항 내용입니다.",
    });
  });

  it("fails SAFE (not open): an untagged paragraph defaults to the strictest type, 'evidence'", () => {
    expect(parseAnswerBlock("태그가 없는 문단입니다.")).toEqual({ type: "evidence", text: "태그가 없는 문단입니다." });
  });
});

describe("assertAnswerBlockGrounded / assertAnswerGrounded (§AI 답변 품질 개편 P0-4)", () => {
  const citation = buildCitation();
  const marker = `[출처: ${citation.clauseReference} - ${citation.contractTitle}]`;

  it("1. accepts a valid multi-block answer: 결론 (no marker needed) + 근거 (marker required) + 확인사항 (no marker needed), returning tag-stripped text", () => {
    const answer = [
      `${ANSWER_BLOCK_TAGS.conclusion} 네, 자동 갱신되는 구조입니다.`,
      `${ANSWER_BLOCK_TAGS.evidence} 계약기간 종료 후 자동 갱신됩니다. ${marker}`,
      `${ANSWER_BLOCK_TAGS.action} 종료일 30일 전까지 통지 가능한지 확인하십시오.`,
    ].join("\n\n");
    const grounded = assertAnswerGrounded(answer, [citation]);
    expect(grounded).toBe(
      ["네, 자동 갱신되는 구조입니다.", `계약기간 종료 후 자동 갱신됩니다. ${marker}`, "종료일 30일 전까지 통지 가능한지 확인하십시오."].join(
        "\n\n"
      )
    );
  });

  it("2. rejects an uncited factual (근거) paragraph exactly as strictly as before", () => {
    const answer = `${ANSWER_BLOCK_TAGS.evidence} 이 조항에 따르면 계약을 해지할 수 있습니다.`;
    expect(() => assertAnswerGrounded(answer, [citation])).toThrow(/citation 표시가 없는 근거 문단/);
  });

  it("3. a harmless [결론] direct-answer/introduction block with NO citation marker is allowed through", () => {
    const block = parseAnswerBlock(`${ANSWER_BLOCK_TAGS.conclusion} 네, 이 계약은 자동 갱신되는 구조입니다.`);
    expect(() => assertAnswerBlockGrounded(block, [citation])).not.toThrow();
  });

  it("4. a practical-action [확인사항] block derived from cited evidence, with no marker of its own, is allowed through", () => {
    const block = parseAnswerBlock(`${ANSWER_BLOCK_TAGS.action} 갱신을 막으려면 종료일 30일 전까지 통지하십시오.`);
    expect(() => assertAnswerBlockGrounded(block, [citation])).not.toThrow();
  });

  it("5. a hallucinated/nonexistent citation marker is rejected in EVERY block type, not just 근거", () => {
    const forgedMarker = "[출처: 가짜조항 - 존재하지않는계약]";
    for (const tag of [ANSWER_BLOCK_TAGS.conclusion, ANSWER_BLOCK_TAGS.evidence, ANSWER_BLOCK_TAGS.action]) {
      const block = parseAnswerBlock(`${tag} 이 내용은 사실입니다. ${forgedMarker}`);
      expect(() => assertAnswerBlockGrounded(block, [citation]), `tag ${tag} should reject a forged marker`).toThrow(
        /citation 표시가 실제 제공된 근거와 일치하지 않/
      );
    }
  });

  it("an untagged paragraph with no marker is rejected (fail-safe default, same as an explicit 근거 paragraph)", () => {
    const answer = "태그도 없고 근거 표시도 없는 문단입니다.";
    expect(() => assertAnswerGrounded(answer, [citation])).toThrow(/citation 표시가 없는 근거 문단/);
  });

  it("assertAnswerGrounded still throws defensively on zero citations / empty answer, matching assertEveryParagraphHasCitation's invariants", () => {
    expect(() => assertAnswerGrounded("아무 내용", [])).toThrow();
    expect(() => assertAnswerGrounded("   ", [citation])).toThrow();
  });

  it("assertEveryParagraphHasCitation (the OLD strict function, used by generate-ai-clause-review.ts/evaluation) is completely unaffected by the new tagged format - it still requires every paragraph to carry its own marker, tags or not", () => {
    const taggedButUnmarkedConclusion = `${ANSWER_BLOCK_TAGS.conclusion} 결론 문단인데 근거 표시가 없습니다.`;
    expect(() => assertEveryParagraphHasCitation(taggedButUnmarkedConclusion, [citation])).toThrow();
  });

  it("§Production Smoke 2026-09-08 finding - every grounding rejection throws the typed AiGroundingError, never a bare Error, so it can never be misclassified as a provider failure downstream (see ask-question.ts's classifyAiStreamError())", () => {
    const forgedMarker = "[출처: 가짜조항 - 존재하지않는계약]";

    try {
      assertAnswerBlockGrounded(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.evidence} 사실이 아닙니다. ${forgedMarker}`), [citation]);
      throw new Error("expected assertAnswerBlockGrounded to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGroundingError);
    }

    try {
      assertAnswerGrounded("근거 표시가 없는 문단입니다.", [citation]);
      throw new Error("expected assertAnswerGrounded to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGroundingError);
    }

    try {
      assertEveryParagraphHasCitation("근거 표시가 없는 문단입니다.", [citation]);
      throw new Error("expected assertEveryParagraphHasCitation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGroundingError);
    }
  });

  it("§Root Cause Phase 2 - assertAnswerBlockGrounded's two live-streaming throw sites carry the exact-match groundingReason; nothing else does", () => {
    const forgedMarker = "[출처: 가짜조항 - 존재하지않는계약]";

    try {
      assertAnswerBlockGrounded(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.evidence} 사실이 아닙니다. ${forgedMarker}`), [citation]);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGroundingError);
      expect((error as AiGroundingError).groundingReason).toBe(GROUNDING_REASONS.UNKNOWN_CITATION_MARKER);
    }

    try {
      assertAnswerBlockGrounded(parseAnswerBlock(`${ANSWER_BLOCK_TAGS.evidence} 표시가 없는 문단입니다.`), [citation]);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGroundingError);
      expect((error as AiGroundingError).groundingReason).toBe(GROUNDING_REASONS.MISSING_REQUIRED_CITATION);
    }

    // assertAnswerGrounded delegates its OWN per-paragraph check to
    // parseAnswerBlock()+assertAnswerBlockGrounded() internally (see
    // citation-required.ts), so an untagged paragraph (defaulting to
    // "evidence" - parseAnswerBlock's fail-safe default) legitimately
    // inherits the SAME wired reason through that delegation - this is
    // not a separate throw site, just the same one reused.
    try {
      assertAnswerGrounded("근거 표시가 없는 문단입니다.", [citation]);
      throw new Error("expected to throw");
    } catch (error) {
      expect((error as AiGroundingError).groundingReason).toBe(GROUNDING_REASONS.MISSING_REQUIRED_CITATION);
    }

    // assertEveryParagraphHasCitation, by contrast, has its OWN fully
    // independent marker-checking loop (never calls
    // assertAnswerBlockGrounded) - its throw site is intentionally left
    // unreasoned (see citation-required.ts's own throw site + this
    // file's earlier "never a bare Error" test).
    try {
      assertEveryParagraphHasCitation("근거 표시가 없는 문단입니다.", [citation]);
      throw new Error("expected to throw");
    } catch (error) {
      expect((error as AiGroundingError).groundingReason).toBeUndefined();
    }
  });
});

describe("§AI 답변 품질 개편 Phase 1.4 (real-OpenAI rerun regression) - a paragraph spanning two supplied provisions", () => {
  const article4 = buildCitation({
    contractClauseId: "c4",
    clauseReference: "제4조",
    contractTitle: "품질 평가용 테스트 계약",
    evidenceText: "발주자는 계약기간 중이라도 30일 전 서면 통지로 본 계약을 해지할 수 있다.",
  });
  const article5 = buildCitation({
    contractClauseId: "c5",
    clauseReference: "제5조",
    contractTitle: "품질 평가용 테스트 계약",
    evidenceText: "발주자는 수행자로부터 세금계산서를 수령한 날로부터 30일 이내에 용역대금을 지급하여야 한다.",
  });

  it('a. reproduces the exact real-OpenAI q1 failure deterministically: a single 근거 block making BOTH an Article 4 claim and an Article 5 claim, ending with ONE combined marker "[출처: 제4조, 제5조 - 계약명]" - the real captured pattern. Once fixed, this must PASS (both provisions are real, valid, supplied citations - a well-intentioned combined reference, not a fabrication).', () => {
    const block = `${ANSWER_BLOCK_TAGS.evidence} 제4조에 따르면 발주자는 계약기간 중이라도 30일 전 서면 통지로 계약을 해지할 수 있습니다. 또한 제5조는 대금을 세금계산서 수령일로부터 30일 이내에 지급해야 한다고 규정합니다. [출처: 제4조, 제5조 - 품질 평가용 테스트 계약]`;
    expect(() => assertAnswerBlockGrounded(parseAnswerBlock(block), [article4, article5])).not.toThrow();
  });

  it("b. a single-provision block (Article 4 only) with only the Article 4 citation supplied still passes, unaffected by the multi-reference fix", () => {
    const block = `${ANSWER_BLOCK_TAGS.evidence} 제4조에 따르면 발주자는 30일 전 서면 통지로 계약을 해지할 수 있습니다. [출처: 제4조 - 품질 평가용 테스트 계약]`;
    expect(() => assertAnswerBlockGrounded(parseAnswerBlock(block), [article4])).not.toThrow();
  });

  it("c. the SAME two-provision claim, but the marker also names a fabricated Article 99 that was never supplied, still FAILS - splitting a combined reference into parts must never let ONE fabricated part hide behind two real ones", () => {
    const block = `${ANSWER_BLOCK_TAGS.evidence} 제4조와 제5조, 그리고 제99조에 따르면... [출처: 제4조, 제5조, 제99조 - 품질 평가용 테스트 계약]`;
    expect(() => assertAnswerBlockGrounded(parseAnswerBlock(block), [article4, article5])).toThrow(
      /citation 표시가 실제 제공된 근거와 일치하지 않/
    );
  });

  it("a REAL fabricated single-reference marker (no comma at all) still fails exactly as before - the fix is additive, not a general loosening", () => {
    const block = `${ANSWER_BLOCK_TAGS.evidence} 존재하지 않는 조항입니다. [출처: 제99조 - 품질 평가용 테스트 계약]`;
    expect(() => assertAnswerBlockGrounded(parseAnswerBlock(block), [article4, article5])).toThrow(
      /citation 표시가 실제 제공된 근거와 일치하지 않/
    );
  });
});
