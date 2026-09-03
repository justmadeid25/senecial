import { describe, expect, it } from "vitest";

import { extractChunkEvidence, extractEvidenceSentence } from "@/domain/ai/evidence-sentence";

describe("extractEvidenceSentence (unchanged behavior - single-article clause text)", () => {
  it("returns the single sentence when there is only one", () => {
    expect(extractEvidenceSentence("계약을 해지할 수 있다.", "해지")).toBe("계약을 해지할 수 있다.");
  });

  it("picks the sentence most relevant to the question out of several", () => {
    const text = "제1조는 목적을 정한다. 상대방이 계약을 위반하면 즉시 해지할 수 있다. 비밀유지 의무는 별도로 정한다.";
    expect(extractEvidenceSentence(text, "계약 해지 조건이 뭐야?")).toContain("해지");
  });
});

describe("extractChunkEvidence (§AI 답변 품질 개편 P0-3 - citation correctness fix)", () => {
  const MULTI_ARTICLE_CHUNK = [
    "제16조(불가항력)",
    "천재지변, 전쟁, 감염병 등 당사자가 통제할 수 없는 사유로 본 계약상 의무의 이행이 지연되거나 불가능하게 된 경우, 그 당사자는 해당 범위 내에서 책임을 지지 아니한다.",
    "",
    "제17조(준거법 및 관할)",
    "본 계약은 대한민국 법을 준거법으로 하며, 본 계약과 관련하여 발생하는 분쟁에 대하여는 서울중앙지방법원을 제1심 관할법원으로 한다.",
  ].join("\n");

  it("evidence from 제16조 is never labeled 제17조 - the exact regression case (chunk's stored headingContext is the LAST article, 제17조, but the question is about 제16조's content)", () => {
    const result = extractChunkEvidence(MULTI_ARTICLE_CHUNK, "천재지변 같은 거 생기면 어떻게 돼?", "제17조(준거법 및 관할)");
    expect(result.evidenceText).toContain("천재지변");
    expect(result.headingContext).toBe("제16조(불가항력)");
    expect(result.headingContext).not.toBe("제17조(준거법 및 관할)");
  });

  it("evidence from 제17조 is never labeled 제16조 - the symmetric case", () => {
    // A question with genuine keyword-stem overlap ("관할") against
    // sentence 2's own text ("관할법원") - matches how real retrieval
    // actually differentiates (keyword-stem score is weighted higher than
    // trigram similarity - see hybrid-search-scoring.ts's KEYWORD_WEIGHT).
    // A question with zero literal overlap against EITHER sentence falls
    // to noisy trigram-only scoring and is not a reliable way to test
    // sentence SELECTION correctness (that is evidence-sentence.ts's own
    // pre-existing, separately-tested concern) - this test is specifically
    // about LABELING correctness once a sentence is selected.
    const result = extractChunkEvidence(MULTI_ARTICLE_CHUNK, "관할 법원이 어디야?", "제17조(준거법 및 관할)");
    expect(result.evidenceText).toContain("관할법원");
    expect(result.headingContext).toBe("제17조(준거법 및 관할)");
  });

  it("falls back to the chunk's own stored headingContext when the selected sentence has no preceding heading at all (e.g. the chunk begins mid-article, before any heading line)", () => {
    const noHeadingChunk = "이 조항은 별도의 표제 없이 이어지는 본문이다. 계약과 관련된 일반 조항이다.";
    const result = extractChunkEvidence(noHeadingChunk, "일반 조항", "제5조(대금지급)");
    expect(result.headingContext).toBe("제5조(대금지급)");
  });

  it("single-sentence chunk (no scoring loop) still resolves a correct heading when one is present", () => {
    const singleSentenceChunk = "제9조(하자보수)\n검수 완료 후 6개월 이내에 하자를 보수한다.";
    const result = extractChunkEvidence(singleSentenceChunk, "하자", "제9조(하자보수)");
    expect(result.headingContext).toBe("제9조(하자보수)");
    expect(result.evidenceText).toContain("하자");
  });

  it("evidence text is truncated/collapsed identically to extractEvidenceSentence's own contract (same MAX_EVIDENCE_LENGTH, same whitespace collapsing)", () => {
    const result = extractChunkEvidence(MULTI_ARTICLE_CHUNK, "관할", "제17조(준거법 및 관할)");
    expect(result.evidenceText).not.toContain("\n");
    expect(result.evidenceText.length).toBeLessThanOrEqual(500);
  });
});
