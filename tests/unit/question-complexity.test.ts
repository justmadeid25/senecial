import { describe, expect, it } from "vitest";

import { classifyQuestionComplexity } from "@/domain/ai/question-complexity";

describe("classifyQuestionComplexity (Phase 14.1 §15)", () => {
  it("classifies a single-fact question as focused", () => {
    expect(classifyQuestionComplexity("계약 해지 조항이 뭐야?")).toBe("focused");
    expect(classifyQuestionComplexity("대금은 언제 지급되나요?")).toBe("focused");
    expect(classifyQuestionComplexity("비밀유지 의무는 언제까지 유지되나요?")).toBe("focused");
  });

  it("classifies a whole-contract review request as comprehensive", () => {
    expect(classifyQuestionComplexity("이 계약의 위험 조항을 모두 검토해줘")).toBe("comprehensive");
    expect(classifyQuestionComplexity("계약서 전체를 검토해줘")).toBe("comprehensive");
    expect(classifyQuestionComplexity("전반적으로 문제될 만한 부분이 있나요?")).toBe("comprehensive");
    expect(classifyQuestionComplexity("이 계약을 요약해 줘")).toBe("comprehensive");
    expect(classifyQuestionComplexity("어떤 위험이 있는지 빠짐없이 알려줘")).toBe("comprehensive");
  });

  it("never throws on empty or unusual input", () => {
    expect(() => classifyQuestionComplexity("")).not.toThrow();
    expect(classifyQuestionComplexity("")).toBe("focused");
  });

  it("§AI 답변 품질 개편 - classifies the audit's under-covered broad questions as comprehensive, not focused (they have no single clause topic to anchor a narrow retrieval to)", () => {
    expect(classifyQuestionComplexity("내가 불리한 게 뭐야?")).toBe("comprehensive");
    expect(classifyQuestionComplexity("주의할 조항 있어?")).toBe("comprehensive");
    expect(classifyQuestionComplexity("꼭 봐야 할 내용 알려줘")).toBe("comprehensive");
  });

  it("a genuinely narrow question mentioning an unrelated word does not accidentally become comprehensive", () => {
    // Sanity check that the new keywords are specific enough not to fire on ordinary focused questions.
    expect(classifyQuestionComplexity("계약 해지 조항이 뭐야?")).toBe("focused");
    expect(classifyQuestionComplexity("대금은 언제 지급되나요?")).toBe("focused");
  });

  describe("§AI 답변 품질 개편 Phase 1.1 P0-2 - measured misclassification from the real-world evaluation", () => {
    it("positive: natural broad-review phrasings are classified comprehensive", () => {
      expect(classifyQuestionComplexity("내 입장에서 이상한 조건 있어?")).toBe("comprehensive");
      expect(classifyQuestionComplexity("이상한 조항 있어?")).toBe("comprehensive");
      expect(classifyQuestionComplexity("특이한 조건 있어?")).toBe("comprehensive");
      expect(classifyQuestionComplexity("문제될 만한 조항 있어?")).toBe("comprehensive");
      expect(classifyQuestionComplexity("조심해야 할 거 있어?")).toBe("comprehensive");
    });

    it("negative: a genuinely FOCUSED question containing the bare, ambiguous word 문제 must NOT be swept into comprehensive - the exact case the implementation task warned about", () => {
      // From the same evaluation (q29) - a narrow, single-answer liability
      // question, not a broad review request. If bare "문제" were used as
      // a standalone trigger (like the original 모든/모두/전체 list), this
      // would incorrectly become comprehensive.
      expect(classifyQuestionComplexity("문제 생기면 누가 책임져?")).toBe("focused");
      expect(classifyQuestionComplexity("문제 있으면 어떻게 해요?")).toBe("focused");
    });

    it("negative: bare 이상한/특이한/조심 without review-shape context stays focused", () => {
      expect(classifyQuestionComplexity("이상한 사람이 계약서에 서명했어요")).toBe("focused");
      expect(classifyQuestionComplexity("조심해서 검토했어요")).toBe("focused");
    });
  });
});
