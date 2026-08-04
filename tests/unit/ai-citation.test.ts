import { describe, expect, it } from "vitest";

import { assertCitationsPresent, type Citation } from "@/domain/ai/citation";
import { buildContext, deduplicateByNormalizedText } from "@/domain/ai/context-builder";
import { extractEvidenceSentence } from "@/domain/ai/evidence-sentence";

describe("extractEvidenceSentence (Phase 12 Part C)", () => {
  it("picks the sentence most relevant to the question, not just the first one", () => {
    const clauseText =
      "본 조항은 일반 조건을 정한다. 계약 해지는 서면 통지로 이루어져야 한다. 기타 사항은 별도로 정한다.";
    const evidence = extractEvidenceSentence(clauseText, "계약을 해지하는 방법은?");
    expect(evidence).toContain("해지");
  });

  it("falls back to the first sentence when no keyword matches", () => {
    const clauseText = "첫 번째 문장이다. 두 번째 문장이다.";
    const evidence = extractEvidenceSentence(clauseText, "전혀 무관한 xyz");
    expect(evidence).toBe("첫 번째 문장이다.");
  });

  it("truncates to 500 characters", () => {
    const longSentence = "가".repeat(600) + ".";
    const evidence = extractEvidenceSentence(longSentence, "질문");
    expect(evidence.length).toBeLessThanOrEqual(500);
  });

  it("never returns an empty string for non-empty input", () => {
    expect(extractEvidenceSentence("단일 문장", "질문").length).toBeGreaterThan(0);
  });
});

describe("buildContext (Phase 12 Part C §Context Builder)", () => {
  it("uses clauseNumber when present", () => {
    const context = buildContext(
      {
        contractClauseId: "c1",
        contractId: "k1",
        contractTitle: "테스트 계약",
        clauseNumber: "제3조",
        title: "해지",
        text: "계약 해지는 서면으로 한다.",
        score: 0.8,
      },
      "해지 방법"
    );
    expect(context.clauseReference).toBe("제3조");
    expect(context.contractTitle).toBe("테스트 계약");
    expect(context.evidenceText.length).toBeGreaterThan(0);
  });

  it("falls back to title, then a fixed label, when clauseNumber is null", () => {
    const withTitle = buildContext(
      { contractClauseId: "c1", contractId: "k1", contractTitle: "계약", clauseNumber: null, title: "해지 조항", text: "본문", score: 0.5 },
      "질문"
    );
    expect(withTitle.clauseReference).toBe("해지 조항");

    const withNeither = buildContext(
      { contractClauseId: "c1", contractId: "k1", contractTitle: "계약", clauseNumber: null, title: null, text: "본문", score: 0.5 },
      "질문"
    );
    expect(withNeither.clauseReference).toBe("조항 번호 미상");
  });
});

describe("deduplicateByNormalizedText (Phase 12 Part C §Deduplicate)", () => {
  it("keeps only the first (highest-scored) occurrence of duplicate text", () => {
    const results = [
      { id: "a", text: "동일한   조항 내용입니다." },
      { id: "b", text: "동일한 조항 내용입니다." }, // same after whitespace normalization
      { id: "c", text: "다른 조항 내용입니다." },
    ];
    const deduped = deduplicateByNormalizedText(results);
    expect(deduped.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
  });
});

describe("assertCitationsPresent (Phase 12 Part F §Citation Required)", () => {
  const validCitation: Citation = {
    contractClauseId: "c1",
    contractId: "k1",
    contractTitle: "테스트 계약",
    clauseReference: "제3조",
    evidenceText: "근거 문장입니다.",
    score: 0.9,
  };

  it("passes for a well-formed citation list", () => {
    expect(() => assertCitationsPresent([validCitation])).not.toThrow();
  });

  it("throws for an empty citation list", () => {
    expect(() => assertCitationsPresent([])).toThrow(/근거\(citation\)가 없어/);
  });

  it("throws when contractTitle is blank", () => {
    expect(() => assertCitationsPresent([{ ...validCitation, contractTitle: "  " }])).toThrow(/계약명/);
  });

  it("throws when clauseReference is blank", () => {
    expect(() => assertCitationsPresent([{ ...validCitation, clauseReference: "" }])).toThrow(/조항 번호/);
  });

  it("throws when evidenceText is blank", () => {
    expect(() => assertCitationsPresent([{ ...validCitation, evidenceText: "" }])).toThrow(/근거 문장/);
  });
});
