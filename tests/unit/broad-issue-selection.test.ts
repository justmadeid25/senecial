import { describe, expect, it } from "vitest";

import {
  classifyCitationIssue,
  DEFAULT_MAX_ISSUE_GROUPS,
  groupCitationsByIssue,
  isExhaustiveReviewRequest,
  parseExplicitRequestedIssueCount,
  selectBroadIssueCandidates,
} from "@/domain/ai/broad-issue-selection";
import type { ClauseCitation, Citation } from "@/domain/ai/citation";

const CONTRACT_ID = "contract-1";
const CONTRACT_TITLE = "품질 평가용 테스트 계약";

function clause(overrides: Partial<ClauseCitation> = {}): ClauseCitation {
  return {
    evidenceType: "clause",
    contractClauseId: `clause-${overrides.clauseReference ?? "x"}`,
    chunkId: null,
    contractId: CONTRACT_ID,
    contractTitle: CONTRACT_TITLE,
    clauseReference: "제1조",
    evidenceText: "근거 문장",
    score: 0.3,
    ...overrides,
  };
}

// Mirrors the exact "품질 평가용 테스트 계약" fixture used throughout this
// whole project's real-OpenAI evaluations - the same 17-article contract
// q14's real failure was measured against.
const 제1조_목적 = clause({ contractClauseId: "c1", clauseReference: "제1조", evidenceText: "본 계약은 발주자와 수행자 간 용역 수행에 관한 제반 사항을 정함을 목적으로 한다.", score: 0.12 });
const 제2조_자동연장 = clause({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "기간 만료 30일 전까지 갱신 거절 통지가 없는 경우 동일한 조건으로 1년씩 자동 연장된다.", score: 0.41 });
const 제3조_계약해지 = clause({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "서면 시정 요구를 받은 날로부터 14일 이내에 시정하지 아니하는 경우 즉시 본 계약을 해지할 수 있다.", score: 0.2 });
const 제4조_중도해지 = clause({ contractClauseId: "c4", clauseReference: "제4조", evidenceText: "해지 시점까지 완료된 부분에 대한 대가를 지급하고, 잔여 계약금액의 10%를 위약금으로 지급한다.", score: 0.38 });
const 제5조_대금지급 = clause({ contractClauseId: "c5", clauseReference: "제5조", evidenceText: "세금계산서를 수령한 날로부터 30일 이내에 용역대금을 지정 계좌로 지급하여야 한다.", score: 0.18 });
const 제6조_지연이자 = clause({ contractClauseId: "c6", clauseReference: "제6조", evidenceText: "지급기한을 도과한 경우 연 12%의 비율에 의한 지연이자를 가산하여 지급하여야 한다.", score: 0.35 });
const 제10조_손해배상 = clause({ contractClauseId: "c10", clauseReference: "제10조", evidenceText: "귀책사유로 상대방에게 손해가 발생한 경우 실제 손해를 배상할 책임을 진다.", score: 0.19 });
const 제11조_책임제한 = clause({ contractClauseId: "c11", clauseReference: "제11조", evidenceText: "손해배상액은 발주자가 수행자에게 지급한 총 대금의 범위 내로 제한된다.", score: 0.31 });
const 제12조_비밀유지 = clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "취득한 상대방의 영업상 비밀을 제3자에게 누설하거나 목적 외로 사용하여서는 아니 된다.", score: 0.25 });
const 제14조_양도제한 = clause({ contractClauseId: "c14", clauseReference: "제14조", evidenceText: "상대방의 사전 서면 동의 없이 본 계약상의 권리 또는 의무를 제3자에게 양도하거나 담보로 제공할 수 없다.", score: 0.22 });

const Q14_CONTEXT: Citation[] = [
  제1조_목적,
  제2조_자동연장,
  제3조_계약해지,
  제4조_중도해지,
  제5조_대금지급,
  제6조_지연이자,
  제10조_손해배상,
  제11조_책임제한,
  제12조_비밀유지,
  제14조_양도제한,
];

describe("classifyCitationIssue (§AI 답변 품질 개편 Phase 1.4.3)", () => {
  it("classifies material risk signals correctly", () => {
    expect(classifyCitationIssue(제2조_자동연장).category).toBe("auto_renewal");
    expect(classifyCitationIssue(제2조_자동연장).tier).toBe("material");
    expect(classifyCitationIssue(제3조_계약해지).category).toBe("termination_penalty");
    expect(classifyCitationIssue(제4조_중도해지).category).toBe("termination_penalty");
    expect(classifyCitationIssue(제6조_지연이자).category).toBe("payment_delay_interest");
    expect(classifyCitationIssue(제11조_책임제한).category).toBe("liability_cap");
  });

  it("classifies ordinary boilerplate as the boilerplate tier", () => {
    expect(classifyCitationIssue(제12조_비밀유지)).toMatchObject({ category: "boilerplate_confidentiality", tier: "boilerplate" });
    expect(classifyCitationIssue(제14조_양도제한)).toMatchObject({ category: "boilerplate_assignment", tier: "boilerplate" });
  });

  it("an override: a nominally-boilerplate clause with a concrete material signal (e.g. a percentage/penalty) is classified by that material signal instead", () => {
    const unusualConfidentiality = clause({
      clauseReference: "제99조",
      evidenceText: "비밀유지 의무를 위반하는 경우 위약금으로 계약금액의 50%를 지급한다.",
    });
    expect(classifyCitationIssue(unusualConfidentiality).tier).toBe("material");
    expect(classifyCitationIssue(unusualConfidentiality).category).toBe("termination_penalty");
  });

  it("never throws on empty/unusual text and falls back to 'other' at neutral tier", () => {
    const unclassifiable = clause({ clauseReference: "제88조", evidenceText: "당사자는 본 계약의 원활한 이행을 위하여 상호 성실히 협조한다." });
    // "협조" matches boilerplate_general - confirms the fallback path is reachable via a genuinely uncategorizable text instead.
    const trulyUnclassifiable = clause({ clauseReference: "제77조", evidenceText: "xyz abc 123" });
    expect(() => classifyCitationIssue(unclassifiable)).not.toThrow();
    expect(classifyCitationIssue(trulyUnclassifiable)).toMatchObject({ category: "other", tier: "neutral" });
  });
});

describe("groupCitationsByIssue - §requirement 5 (grouped citations do not inflate issue count)", () => {
  it("Article 3 (해지) + Article 4 (중도해지/위약금) - both termination_penalty - form ONE group, not two", () => {
    const groups = groupCitationsByIssue([제3조_계약해지, 제4조_중도해지]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("termination_penalty");
    expect(groups[0]!.citations.map((c) => c.contractClauseId).sort()).toEqual(["c3", "c4"]);
  });

  it("Article 5 (대금지급) + Article 6 (지연이자) - both payment_delay_interest - form ONE group", () => {
    const groups = groupCitationsByIssue([제5조_대금지급, 제6조_지연이자]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("payment_delay_interest");
  });

  it("a group's maxScore is the highest score among its own member citations", () => {
    const groups = groupCitationsByIssue([제3조_계약해지, 제4조_중도해지]);
    expect(groups[0]!.maxScore).toBeCloseTo(Math.max(제3조_계약해지.score, 제4조_중도해지.score));
  });

  it("§no-overgeneralization guard - auto_renewal (Article 2) and termination_penalty (Article 3/4) are DIFFERENT groups, never merged - keeping the renewal-rejection deadline structurally separate from other termination rights is what prevents the model from conflating them in prose", () => {
    const groups = groupCitationsByIssue([제2조_자동연장, 제3조_계약해지, 제4조_중도해지]);
    const categories = groups.map((g) => g.category).sort();
    expect(categories).toEqual(["auto_renewal", "termination_penalty"]);
  });
});

describe("selectBroadIssueCandidates - §requirements 1-6", () => {
  it("q14-like fixture (\"내 입장에서 이상한 조건 있어?\") selects <=4 issue groups, and material issues outrank ordinary confidentiality/assignment", () => {
    const result = selectBroadIssueCandidates({ question: "내 입장에서 이상한 조건 있어?", citations: Q14_CONTEXT });

    expect(result.exhaustive).toBe(false);
    expect(result.selectedGroups.length).toBeLessThanOrEqual(DEFAULT_MAX_ISSUE_GROUPS);
    expect(result.selectedGroups.length).toBeLessThanOrEqual(4);

    const selectedCategories = result.selectedGroups.map((g) => g.category);
    // The exact 4 material issues present in this fixture, matching the
    // real captured q14 transcript's own genuinely-material picks.
    expect(selectedCategories.sort()).toEqual(["auto_renewal", "liability_cap", "payment_delay_interest", "termination_penalty"]);

    // Ordinary confidentiality/assignment are excluded entirely.
    expect(selectedCategories).not.toContain("boilerplate_confidentiality");
    expect(selectedCategories).not.toContain("boilerplate_assignment");
    const selectedClauseIds = new Set(result.selectedCitations.map((c) => c.contractClauseId));
    expect(selectedClauseIds.has("c12")).toBe(false);
    expect(selectedClauseIds.has("c14")).toBe(false);
  });

  it("selected citations are exactly the union of the selected groups' own citations - grouped Article 3+4 both survive as termination_penalty's two citations", () => {
    const result = selectBroadIssueCandidates({ question: "이상한 조건 있어?", citations: Q14_CONTEXT });
    const terminationGroup = result.selectedGroups.find((g) => g.category === "termination_penalty");
    expect(terminationGroup?.citations.map((c) => c.contractClauseId).sort()).toEqual(["c3", "c4"]);
  });

  it("never invents a citation - every selectedCitations entry is a real object from the input array (requirement 7)", () => {
    const result = selectBroadIssueCandidates({ question: "이상한 조건 있어?", citations: Q14_CONTEXT });
    for (const citation of result.selectedCitations) {
      expect(Q14_CONTEXT).toContain(citation);
    }
  });

  it("§requirement 2 - an explicit exhaustive-review request (\"전체 검토해줘\") bypasses the cap entirely - every group is selected, including boilerplate ones", () => {
    const result = selectBroadIssueCandidates({ question: "이 계약을 전체 검토해줘", citations: Q14_CONTEXT });
    expect(result.exhaustive).toBe(true);
    const selectedCategories = result.selectedGroups.map((g) => g.category);
    expect(selectedCategories).toContain("boilerplate_confidentiality");
    expect(selectedCategories).toContain("boilerplate_assignment");
    expect(result.selectedCitations).toHaveLength(Q14_CONTEXT.length);
  });

  it("§requirement 2 - an explicit requested count (\"3개만\") overrides the default cap of 4", () => {
    const result = selectBroadIssueCandidates({ question: "주의할 조항 3개만 알려줘", citations: Q14_CONTEXT });
    expect(result.exhaustive).toBe(false);
    expect(result.selectedGroups.length).toBeLessThanOrEqual(3);
  });

  it("§requirement 2 - an explicit count above the safe bound is clamped, never allowed to fully defeat prioritization", () => {
    const result = selectBroadIssueCandidates({ question: "조항 100개 알려줘", citations: Q14_CONTEXT });
    expect(result.exhaustive).toBe(false);
    expect(result.selectedGroups.length).toBeLessThanOrEqual(8);
  });

  it("real retrieval breadth (more candidates than groups can hold) still respects the cap - only the top-ranked groups survive", () => {
    const manyMaterial = [
      clause({ contractClauseId: "ex1", clauseReference: "제20조", evidenceText: "독점적으로 거래하며 경업금지 의무를 진다.", score: 0.5 }),
      clause({ contractClauseId: "ex2", clauseReference: "제21조", evidenceText: "지식재산권은 발주자에게 귀속된다.", score: 0.45 }),
    ];
    const result = selectBroadIssueCandidates({ question: "이상한 조건 있어?", citations: [...Q14_CONTEXT, ...manyMaterial] });
    expect(result.selectedGroups.length).toBeLessThanOrEqual(4);
  });
});

describe("isExhaustiveReviewRequest / parseExplicitRequestedIssueCount (pure helpers)", () => {
  it("recognizes exhaustive-review phrasing", () => {
    expect(isExhaustiveReviewRequest("이 계약을 전체 검토해줘")).toBe(true);
    expect(isExhaustiveReviewRequest("빠짐없이 알려줘")).toBe(true);
    expect(isExhaustiveReviewRequest("모든 조항을 검토해줘")).toBe(true);
    expect(isExhaustiveReviewRequest("모두 검토해줘")).toBe(true);
  });

  it("does NOT treat an ordinary evaluative question as exhaustive", () => {
    expect(isExhaustiveReviewRequest("내 입장에서 이상한 조건 있어?")).toBe(false);
    expect(isExhaustiveReviewRequest("주의해서 볼 조항은?")).toBe(false);
    expect(isExhaustiveReviewRequest("내가 불리한 게 뭐야?")).toBe(false);
  });

  it("parses an explicit count, bounded to the safe range", () => {
    expect(parseExplicitRequestedIssueCount("3개만 알려줘")).toBe(3);
    expect(parseExplicitRequestedIssueCount("5개까지 알려줘")).toBe(5);
    expect(parseExplicitRequestedIssueCount("100개 알려줘")).toBe(8);
    expect(parseExplicitRequestedIssueCount("이상한 조건 있어?")).toBeNull();
  });
});

describe("§focused questions are completely unaffected (requirement: no behavior change outside comprehensive evaluative questions)", () => {
  it("selectBroadIssueCandidates is a pure, standalone function - it has no awareness of question complexity at all, so a focused-question caller that never invokes it (see ask-question.ts's own complexity-gated wiring) sees zero behavior change by construction", () => {
    // This module exports no complexity-aware entry point of its own -
    // ask-question.ts only calls selectBroadIssueCandidates() when
    // classifyQuestionComplexity() === "comprehensive" (see that file's
    // own synthesisCitations wiring). A focused question's contextCitations
    // pass straight through, untouched by this module, by construction.
    const result = selectBroadIssueCandidates({ question: "대금은 언제 지급돼?", citations: [제5조_대금지급] });
    expect(result.selectedCitations).toEqual([제5조_대금지급]);
  });
});
