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
});
