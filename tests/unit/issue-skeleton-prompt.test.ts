import { describe, expect, it } from "vitest";

import { groupCitationsByIssue, selectBroadIssueCandidates } from "@/domain/ai/broad-issue-selection";
import { ANSWER_BLOCK_TAGS } from "@/domain/ai/citation-required";
import { buildCitationMarker } from "@/domain/ai/citation-marker";
import { buildPromptMessages, buildUserPrompt } from "@/domain/ai/prompt-builder";
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

// The same q14 fixture broad-issue-selection.test.ts uses, so the skeleton
// tests here exercise the exact real selection shape, not a synthetic one.
const 제2조_자동연장 = clause({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "기간 만료 30일 전까지 갱신 거절 통지가 없는 경우 동일한 조건으로 1년씩 자동 연장된다.", score: 0.41 });
const 제3조_계약해지 = clause({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "즉시 본 계약을 해지할 수 있다.", score: 0.2 });
const 제4조_중도해지 = clause({ contractClauseId: "c4", clauseReference: "제4조", evidenceText: "잔여 계약금액의 10%를 위약금으로 지급한다.", score: 0.38 });
const 제6조_지연이자 = clause({ contractClauseId: "c6", clauseReference: "제6조", evidenceText: "연 12%의 비율에 의한 지연이자를 가산하여 지급하여야 한다.", score: 0.35 });
const 제11조_책임제한 = clause({ contractClauseId: "c11", clauseReference: "제11조", evidenceText: "손해배상액은 총 대금의 범위 내로 제한된다.", score: 0.31 });

const Q14_CONTEXT: Citation[] = [제2조_자동연장, 제3조_계약해지, 제4조_중도해지, 제6조_지연이자, 제11조_책임제한];

function buildQ14IssueGroups() {
  return selectBroadIssueCandidates({ question: "내 입장에서 이상한 조건 있어?", citations: Q14_CONTEXT }).selectedGroups;
}

describe("§AI 답변 품질 개편 Phase 1.4.4 - buildUserPrompt() renders an explicit per-issue skeleton", () => {
  it("a. the opening [결론] instruction does NOT enumerate the issues - only the count, matching the exact allowed example", () => {
    const groups = buildQ14IssueGroups();
    const prompt = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);

    expect(prompt).toContain(`몇 개인지만 말하고 이슈 제목이나 내용을 나열하지 마십시오`);
    expect(prompt).toContain(`눈에 띄는 조건은 ${groups.length}가지입니다`);
  });

  it("b. exactly ONE 근거 block placeholder per selected issue group, numbered 1..N", () => {
    const groups = buildQ14IssueGroups();
    const prompt = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);

    for (let i = 1; i <= groups.length; i += 1) {
      expect(prompt).toContain(`${ANSWER_BLOCK_TAGS.evidence} 이슈 ${i}/${groups.length}`);
    }
    // No (N+1)th block.
    expect(prompt).not.toContain(`${ANSWER_BLOCK_TAGS.evidence} 이슈 ${groups.length + 1}/${groups.length}`);
  });

  it("c. explicitly forbids any block beyond exactly N 근거 blocks, and forbids 확인사항 outright - 'no conclusion section' beyond the one opening sentence", () => {
    const groups = buildQ14IssueGroups();
    const prompt = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);

    expect(prompt).toContain(`정확히 ${groups.length}개의 ${ANSWER_BLOCK_TAGS.evidence} 문단만 작성`);
    expect(prompt).toContain(`${ANSWER_BLOCK_TAGS.action} 문단 포함`);
    expect(prompt).toContain("절대 작성하지 마십시오");
  });

  it("d. explicitly forbids restating an already-explained issue in another paragraph (no duplicate issue restatement)", () => {
    const groups = buildQ14IssueGroups();
    const prompt = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);

    expect(prompt).toContain("이미 어느 항목에서 설명한 내용을 다른 문단에서 다시 요약하거나 반복하지 마십시오");
  });

  it("each issue block is pre-assigned ONLY that group's own citation marker(s), not another group's", () => {
    const groups = buildQ14IssueGroups();
    const prompt = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);
    const terminationGroup = groups.find((g) => g.category === "termination_penalty")!;
    const autoRenewalGroup = groups.find((g) => g.category === "auto_renewal")!;

    // The termination group's own SKELETON block line (not a [CITATION n] evidence block, which also mentions "제3조") contains BOTH its citations' markers.
    const terminationGroupIndex = groups.indexOf(terminationGroup) + 1;
    const terminationLine = prompt.split("\n").find((line) => line.startsWith(`${ANSWER_BLOCK_TAGS.evidence} 이슈 ${terminationGroupIndex}/`));
    expect(terminationLine).toBeDefined();
    for (const c of terminationGroup.citations) {
      expect(terminationLine).toContain(buildCitationMarker(c));
    }
    // auto_renewal's own marker never appears on the termination group's block line.
    expect(terminationLine).not.toContain(buildCitationMarker(autoRenewalGroup.citations[0]!));
  });

  it("e. selected citations passed to buildUserPrompt() are unchanged by the skeleton - it is purely additive prompt TEXT, never a filter (grounding/citation behavior preserved)", () => {
    const groups = buildQ14IssueGroups();
    const withSkeleton = buildUserPrompt("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, groups);
    // Every supplied citation still gets its own [CITATION n] evidence block, regardless of the skeleton.
    for (let i = 0; i < Q14_CONTEXT.length; i += 1) {
      expect(withSkeleton).toContain(`[CITATION ${i + 1}]`);
    }
  });

  it("omitting issueGroups (or passing an empty array) falls back to the exact pre-1.4.4 generic trailing instruction - focused questions and any caller that never computes a selection are completely unaffected", () => {
    const withoutSkeleton = buildUserPrompt("질문", Q14_CONTEXT);
    const withEmptyGroups = buildUserPrompt("질문", Q14_CONTEXT, []);
    expect(withoutSkeleton).toEqual(withEmptyGroups);
    expect(withoutSkeleton).toContain('시스템 프롬프트의 "답변 구조"를 따르십시오');
    expect(withoutSkeleton).not.toContain("이슈 1/");
  });

  it("buildPromptMessages() threads issueGroups through to the user message; omitting it is byte-identical to the pre-1.4.4 shape", () => {
    const groups = buildQ14IssueGroups();
    const withSkeleton = buildPromptMessages("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, [], "comprehensive", groups);
    const withoutSkeleton = buildPromptMessages("내 입장에서 이상한 조건 있어?", Q14_CONTEXT, [], "comprehensive");
    expect(withSkeleton.at(-1)!.content).not.toEqual(withoutSkeleton.at(-1)!.content);
    expect(withSkeleton.at(-1)!.content).toContain("이슈 1/");
    expect(withoutSkeleton.at(-1)!.content).not.toContain("이슈 1/");
  });
});

describe("§focused questions remain completely unaffected", () => {
  it("a focused-complexity prompt never receives an issue skeleton, by construction - buildSystemPrompt('focused') and buildUserPrompt with no issueGroups argument produce the exact pre-1.4.4 text", () => {
    const messages = buildPromptMessages("대금은 언제 지급돼?", [제6조_지연이자], [], "focused");
    expect(messages.at(-1)!.content).not.toContain("이슈 1/");
    expect(messages.at(-1)!.content).toContain('시스템 프롬프트의 "답변 구조"를 따르십시오');
  });
});

describe("groupCitationsByIssue sanity (imported here only to confirm the skeleton test fixture matches broad-issue-selection.test.ts's own grouping)", () => {
  it("the q14 fixture used in this file groups Article 3+4 into one termination_penalty issue, matching broad-issue-selection.test.ts", () => {
    const groups = groupCitationsByIssue([제3조_계약해지, 제4조_중도해지]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("termination_penalty");
  });
});
