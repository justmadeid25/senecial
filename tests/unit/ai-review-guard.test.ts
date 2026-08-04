import { describe, expect, it } from "vitest";

import { assertNoRiskJudgmentLanguage, RiskJudgmentLanguageError } from "@/domain/ai/ai-review-guard";

describe("assertNoRiskJudgmentLanguage (Phase 12 Part J §AI Review)", () => {
  it("does not throw for a clean, difference-and-evidence-only narrative", () => {
    expect(() =>
      assertNoRiskJudgmentLanguage(
        "이 조항은 기준 조항과 통지 기간에서 차이가 있습니다. [출처: 제1조 - 계약서]"
      )
    ).not.toThrow();
  });

  it.each([
    "이 조항은 위험한 조항입니다.",
    "이 계약은 위험합니다.",
    "이 조항은 안전합니다.",
    "이 조항은 불법입니다.",
    "이 조항은 무효입니다.",
    "이 부분은 반드시 수정해야 합니다.",
    "이 계약은 체결하면 안 됩니다.",
    "이 조항은 법적으로 문제가 있습니다.",
  ])("throws RiskJudgmentLanguageError for banned phrase in: %s", (text) => {
    expect(() => assertNoRiskJudgmentLanguage(text)).toThrow(RiskJudgmentLanguageError);
  });
});
