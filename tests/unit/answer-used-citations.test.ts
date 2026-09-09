import { describe, expect, it } from "vitest";

import { filterCitationsToAnswerUsed } from "@/domain/ai/answer-used-citations";
import { buildCitationMarker } from "@/domain/ai/citation-marker";
import { ANSWER_BLOCK_TAGS, assertAnswerGrounded } from "@/domain/ai/citation-required";
import type { ChunkCitation, ClauseCitation, Citation } from "@/domain/ai/citation";

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

function chunk(overrides: Partial<ChunkCitation> = {}): ChunkCitation {
  return {
    evidenceType: "chunk",
    contractClauseId: null,
    chunkId: `chunk-${overrides.clauseReference ?? "x"}`,
    contractId: CONTRACT_ID,
    contractTitle: CONTRACT_TITLE,
    clauseReference: "제1조(제목)",
    evidenceText: "근거 문장",
    score: 0.3,
    sourcePageStart: null,
    sourcePageEnd: null,
    chunkStartOffset: 0,
    chunkEndOffset: 10,
    ...overrides,
  };
}

/** Builds an answer paragraph citing `citation` by its 1-based position in `contextCitations` - mirroring the real server-issued index token (see citation-marker.ts). `citation` must be a member of `contextCitations` (by reference) - this is a test-fixture helper, not production code. */
function citedParagraph(text: string, contextCitations: readonly Citation[], citation: Citation): string {
  const index = contextCitations.indexOf(citation);
  if (index === -1) throw new Error("test fixture bug: citation not present in contextCitations");
  return `${text} ${buildCitationMarker(index + 1)}`;
}

describe("filterCitationsToAnswerUsed (§AI 답변 품질 개편 Phase 1.4 - citation precision)", () => {
  it("q6-style: the answer only discusses Article 6 (지연이자) - unrelated retrieved evidence (confidentiality/termination/delay-penalty/force-majeure) is never rendered even though it was supplied as context", () => {
    const contextCitations: Citation[] = [
      clause({ contractClauseId: "c6", clauseReference: "제6조", evidenceText: "지연이자를 가산하여 지급한다.", score: 0.45 }),
      clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "비밀유지 의무.", score: 0.3 }),
      clause({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "계약해지.", score: 0.28 }),
      clause({ contractClauseId: "c8", clauseReference: "제8조", evidenceText: "지체상금.", score: 0.25 }),
      clause({ contractClauseId: "c16", clauseReference: "제16조", evidenceText: "불가항력.", score: 0.2 }),
    ];
    const answerText = citedParagraph("대금을 늦게 지급하면 연 12%의 지연이자가 발생합니다.", contextCitations, contextCitations[0]!);

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used).toHaveLength(1);
    expect(used[0]!.clauseReference).toBe("제6조");
  });

  it("q11-style: a jurisdiction answer (Article 17) never renders the confidentiality citation (Article 12) that was also retrieved", () => {
    const contextCitations: Citation[] = [
      clause({ contractClauseId: "c17", clauseReference: "제17조", evidenceText: "서울중앙지방법원을 관할로 한다.", score: 0.4 }),
      clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "비밀유지 의무.", score: 0.22 }),
    ];
    const answerText = citedParagraph("분쟁이 생기면 서울중앙지방법원에서 재판합니다.", contextCitations, contextCitations[0]!);

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used.map((c) => c.clauseReference)).toEqual(["제17조"]);
  });

  it("q7-style: \"돈 떼이면?\" (non-payment) correctly answers via Article 6 (지연이자) and never renders the unrelated Article 8 late-delivery penalty that was also retrieved", () => {
    const contextCitations: Citation[] = [
      clause({ contractClauseId: "c6", clauseReference: "제6조", evidenceText: "연 12%의 지연이자를 가산하여 지급한다.", score: 0.37 }),
      clause({ contractClauseId: "c8", clauseReference: "제8조", evidenceText: "지체상금을 지급한다.", score: 0.22 }),
    ];
    const answerText = citedParagraph("대금을 받지 못하면 연 12%의 지연이자를 청구할 수 있습니다.", contextCitations, contextCitations[0]!);

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used.map((c) => c.clauseReference)).toEqual(["제6조"]);
  });

  it("q16-style: an auto-renewal follow-up answer (Article 2) never renders termination/confidentiality citations retrieved alongside it", () => {
    const contextCitations: Citation[] = [
      clause({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "1년씩 자동 연장된다.", score: 0.5 }),
      clause({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "계약해지.", score: 0.3 }),
      clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "비밀유지 의무.", score: 0.2 }),
    ];
    const answerText = citedParagraph("이 계약은 자동으로 1년씩 갱신됩니다.", contextCitations, contextCitations[0]!);

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used.map((c) => c.clauseReference)).toEqual(["제2조"]);
  });

  it("q13-style: when the answer selects exactly 3 items out of a much larger retrieved set (comprehensive review), only those 3 are rendered", () => {
    const contextCitations: Citation[] = Array.from({ length: 16 }, (_, i) =>
      clause({ contractClauseId: `c${i}`, clauseReference: `제${i + 1}조`, evidenceText: `조항 ${i + 1} 내용.`, score: 1 - i * 0.01 })
    );
    const chosen = [contextCitations[3]!, contextCitations[7]!, contextCitations[11]!];
    const answerText = chosen.map((c, i) => citedParagraph(`주의할 점 ${i + 1}.`, contextCitations, c)).join("\n\n");

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used).toHaveLength(3);
    expect(used.map((c) => c.clauseReference).sort()).toEqual(chosen.map((c) => c.clauseReference).sort());
  });

  describe("deduplication of clause/chunk citations for the same provision", () => {
    it("collapses a clause + chunk citation both referenced for the SAME article down to one, preferring the clause citation", () => {
      const clauseCitation = clause({ contractClauseId: "c7", clauseReference: "제7조", evidenceText: "납품기한.", score: 0.3 });
      const chunkCitation = chunk({ chunkId: "ch7", clauseReference: "제7조(납품 및 검수)", evidenceText: "납품기한.", score: 0.45 });
      const contextCitations: Citation[] = [chunkCitation, clauseCitation];
      const answerText = [
        citedParagraph("납품기한은 별첨 일정표에 따릅니다.", contextCitations, clauseCitation),
        citedParagraph("검수는 인도일로부터 7일 이내에 완료합니다.", contextCitations, chunkCitation),
      ].join("\n\n");

      const used = filterCitationsToAnswerUsed(answerText, contextCitations);

      expect(used).toHaveLength(1);
      expect(used[0]!.evidenceType).toBe("clause");
      expect(used[0]!.contractClauseId).toBe("c7");
    });

    it("keeps a chunk citation when no clause citation for that article was referenced", () => {
      const chunkCitation = chunk({ chunkId: "ch9", clauseReference: "제9조(하자보수)", evidenceText: "하자보수.", score: 0.3 });
      const answerText = citedParagraph("하자는 통지 후 14일 이내에 보수해야 합니다.", [chunkCitation], chunkCitation);

      const used = filterCitationsToAnswerUsed(answerText, [chunkCitation]);

      expect(used).toHaveLength(1);
      expect(used[0]!.evidenceType).toBe("chunk");
    });

    it("never merges the same article number across DIFFERENT contracts", () => {
      const citationA = clause({ contractClauseId: "a7", contractId: "contract-a", contractTitle: "계약 A", clauseReference: "제7조" });
      const citationB = clause({ contractClauseId: "b7", contractId: "contract-b", contractTitle: "계약 B", clauseReference: "제7조" });
      const contextCitations = [citationA, citationB];
      const answerText = [
        citedParagraph("계약 A의 내용.", contextCitations, citationA),
        citedParagraph("계약 B의 내용.", contextCitations, citationB),
      ].join("\n\n");

      const used = filterCitationsToAnswerUsed(answerText, [citationA, citationB]);

      expect(used).toHaveLength(2);
      expect(new Set(used.map((c) => c.contractId))).toEqual(new Set(["contract-a", "contract-b"]));
    });
  });

  it("a marker with no matching supplied citation contributes nothing (safe no-op) - the actual hard rejection of a hallucinated marker happens earlier, in citation-required.ts's assertAnswerBlockGrounded, before this function is ever called with such text", () => {
    const real = clause({ contractClauseId: "c1", clauseReference: "제1조" });
    // Index 99 is out of range for a 1-citation supplied set - the new
    // closed-set-index equivalent of the old "clauseReference/contractTitle
    // that matches nothing" fixture.
    const answerText = `존재하지 않는 근거입니다. ${buildCitationMarker(99)}`;

    const used = filterCitationsToAnswerUsed(answerText, [real]);

    expect(used).toEqual([]);
  });

  it("returns an empty array for an answer with no citation markers at all", () => {
    const real = clause({ contractClauseId: "c1", clauseReference: "제1조" });
    expect(filterCitationsToAnswerUsed("마커가 전혀 없는 문단입니다.", [real])).toEqual([]);
  });

  it("sorts the used set by score descending, matching every other citation list in this codebase", () => {
    const low = clause({ contractClauseId: "low", clauseReference: "제1조", score: 0.1 });
    const high = clause({ contractClauseId: "high", clauseReference: "제2조", score: 0.9 });
    const contextCitations = [low, high];
    const answerText = [
      citedParagraph("낮은 점수.", contextCitations, low),
      citedParagraph("높은 점수.", contextCitations, high),
    ].join("\n\n");

    const used = filterCitationsToAnswerUsed(answerText, [low, high]);

    expect(used.map((c) => c.contractClauseId)).toEqual(["high", "low"]);
  });

  it("d. a valid, fully-grounded answer that only references SOME of the supplied citations never renders the unreferenced ones - retrieval can stay broad without the UI showing every retrieved candidate", () => {
    const used4 = clause({ contractClauseId: "c4", clauseReference: "제4조" });
    const retrievedButUnused = [
      clause({ contractClauseId: "c9", clauseReference: "제9조" }),
      clause({ contractClauseId: "c12", clauseReference: "제12조" }),
      clause({ contractClauseId: "c16", clauseReference: "제16조" }),
    ];
    const contextCitations: Citation[] = [used4, ...retrievedButUnused];
    const answerText = citedParagraph("발주자는 30일 전 서면 통지로 해지할 수 있습니다.", contextCitations, used4);

    const used = filterCitationsToAnswerUsed(answerText, contextCitations);

    expect(used.map((c) => c.contractClauseId)).toEqual(["c4"]);
    for (const unused of retrievedButUnused) {
      expect(used.some((c) => c.contractClauseId === unused.contractClauseId)).toBe(false);
    }
  });

  describe("f. real-OpenAI rerun regression - a q16-style multi-turn follow-up stays grounded AND correctly filtered after the combined-marker fix", () => {
    it("a follow-up answer combining two provisions in one 근거 block (the exact q1 failure shape) both passes grounding validation and renders BOTH cited provisions, never the unrelated ones also supplied as context", () => {
      const article2 = clause({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "1년씩 자동 연장된다." });
      const article4 = clause({ contractClauseId: "c4", clauseReference: "제4조", evidenceText: "30일 전 서면 통지로 해지할 수 있다." });
      const unrelated = clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "비밀유지 의무." });
      const contextCitations: Citation[] = [article2, article4, unrelated];

      // article2/article4 are contextCitations[0]/[1] - a single combined
      // bracket "[출처: 1, 2]" is the numeric-token equivalent of the real
      // captured q1 failure shape (a model combining two provisions in one
      // marker instead of two side-by-side ones).
      const rawAnswer = [
        `${ANSWER_BLOCK_TAGS.conclusion} 그 날짜를 놓치면 계약이 자동으로 1년 더 연장됩니다.`,
        `${ANSWER_BLOCK_TAGS.evidence} 제2조에 따라 갱신 거절 통지가 없으면 자동 연장되고, 제4조에 따라 그 이후에도 30일 전 통지로 해지는 여전히 가능합니다. [출처: 1, 2]`,
      ].join("\n\n");

      const grounded = assertAnswerGrounded(rawAnswer, contextCitations);
      const used = filterCitationsToAnswerUsed(grounded, contextCitations);

      expect(used.map((c) => c.clauseReference).sort()).toEqual(["제2조", "제4조"]);
      expect(used.some((c) => c.contractClauseId === "c12")).toBe(false);
    });

    it("a follow-up answer citing provisions with SEPARATE, well-formed markers (the recommended format) behaves identically", () => {
      const article2 = clause({ contractClauseId: "c2", clauseReference: "제2조" });
      const article4 = clause({ contractClauseId: "c4", clauseReference: "제4조" });
      const contextCitations: Citation[] = [article2, article4];
      const rawAnswer = `${ANSWER_BLOCK_TAGS.evidence} 제2조와 제4조 모두 관련이 있습니다. ${buildCitationMarker(1)} ${buildCitationMarker(2)}`;

      const grounded = assertAnswerGrounded(rawAnswer, contextCitations);
      const used = filterCitationsToAnswerUsed(grounded, contextCitations);

      expect(used.map((c) => c.clauseReference).sort()).toEqual(["제2조", "제4조"]);
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.4.1 - C. q16 unsupported-consequence overreach (\"그 날짜 놓치면 어떻게 돼?\")", () => {
    // §Scope of what this test can prove - assertAnswerGrounded()/
    // filterCitationsToAnswerUsed() validate CITATION markers, never the
    // semantic CONTENT of a claim - neither can detect that "해지가
    // 불가능하며" overreaches beyond what Article 2 (auto-renewal) actually
    // says. Preventing that overreach is prompt-builder.ts's rule 13's job
    // (see ai-llm-pipeline.test.ts's own regression test for that rule's
    // presence) - real model COMPLIANCE can only be confirmed by the
    // real-OpenAI re-evaluation. What this test DOES prove: the pipeline
    // correctly accepts and renders the DESIRED answer shape (states
    // auto-renewal occurs, separately notes a distinct termination right
    // exists, without conflating the two) end to end.
    it("the desired answer shape - auto-renewal occurs, a SEPARATE mid-term termination right is only noted (not conflated with the renewal deadline) - passes grounding and renders both real provisions", () => {
      const article2 = clause({
        contractClauseId: "c2",
        clauseReference: "제2조",
        evidenceText: "갱신 거절 통지가 없는 경우 동일한 조건으로 1년씩 자동 연장된다.",
      });
      const article4 = clause({
        contractClauseId: "c4",
        clauseReference: "제4조",
        evidenceText: "발주자는 계약기간 중이라도 30일 전 서면 통지로 본 계약을 해지할 수 있다.",
      });
      const contextCitations: Citation[] = [article2, article4];

      const rawAnswer = [
        `${ANSWER_BLOCK_TAGS.conclusion} 그 날짜를 놓치면 계약은 동일한 조건으로 1년 더 자동 연장됩니다.`,
        `${ANSWER_BLOCK_TAGS.evidence} 갱신 거절 통지 기한을 놓치면 자동으로 1년 연장됩니다. ${buildCitationMarker(1)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 다만 이는 갱신 거절 통지에 관한 것으로, 계약기간 중 30일 전 서면 통지로 해지하는 별도의 중도해지권과는 별개입니다. ${buildCitationMarker(2)}`,
      ].join("\n\n");

      const grounded = assertAnswerGrounded(rawAnswer, contextCitations);
      expect(grounded).toContain("자동 연장");
      expect(grounded).not.toContain("해지가 불가능");
      expect(grounded).not.toContain("해지할 수 없");

      const used = filterCitationsToAnswerUsed(grounded, contextCitations);
      expect(used.map((c) => c.clauseReference).sort()).toEqual(["제2조", "제4조"]);
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.4.2 - q14 broad-answer prioritization (\"내 입장에서 이상한 조건 있어?\")", () => {
    // §Scope of what this test can prove - same caveat as the q16 describe
    // block above: whether a REAL model actually keeps a broad review to
    // ~3-5 items and skips ordinary boilerplate is prompt-builder.ts's
    // comprehensiveRules job (see ai-llm-pipeline.test.ts's own regression
    // tests for that rule text), not something a citation-marker filter can
    // detect. What this test DOES prove: when the model DOES behave as
    // desired (selects a handful of genuinely material items, leaves
    // ordinary retrieved provisions unselected), the pipeline renders
    // EXACTLY the selected set - never expanded back out to everything
    // that was merely retrieved.
    it("a well-formed prioritized answer selecting 4 of 8 retrieved provisions renders only those 4 - the 2 ordinary ones (confidentiality, assignment) among the unselected 4 are never rendered merely because they were retrieved", () => {
      const materialA = clause({ contractClauseId: "c4", clauseReference: "제4조", evidenceText: "잔여 계약금액의 10%를 위약금으로 지급한다." });
      const materialB = clause({ contractClauseId: "c8", clauseReference: "제8조", evidenceText: "지연 1일당 계약금액의 0.1%에 해당하는 지체상금." });
      const materialC = clause({ contractClauseId: "c11", clauseReference: "제11조", evidenceText: "손해배상액은 총 대금의 범위 내로 제한된다." });
      const materialD = clause({ contractClauseId: "c17", clauseReference: "제17조", evidenceText: "서울중앙지방법원을 관할로 한다." });
      const ordinaryConfidentiality = clause({ contractClauseId: "c12", clauseReference: "제12조", evidenceText: "비밀유지 의무." });
      const ordinaryAssignment = clause({ contractClauseId: "c14", clauseReference: "제14조", evidenceText: "권리·의무 양도 제한." });
      const ordinaryNotice = clause({ contractClauseId: "c9", clauseReference: "제9조", evidenceText: "하자보수 통지." });
      const ordinaryPurpose = clause({ contractClauseId: "c1", clauseReference: "제1조", evidenceText: "목적." });
      const contextCitations: Citation[] = [
        materialA,
        materialB,
        materialC,
        materialD,
        ordinaryConfidentiality,
        ordinaryAssignment,
        ordinaryNotice,
        ordinaryPurpose,
      ];

      // materialA..D are contextCitations[0..3].
      const rawAnswer = [
        `${ANSWER_BLOCK_TAGS.conclusion} 특히 주의해서 볼 조항은 4가지입니다: 중도해지 위약금, 납품 지연 지체상금, 손해배상 한도, 관할 법원입니다.`,
        `${ANSWER_BLOCK_TAGS.evidence} 중도해지 위약금 - 중도 해지 시 잔여 계약금액의 10%를 위약금으로 물어야 합니다. ${buildCitationMarker(1)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 납품 지연 지체상금 - 하루 지연될 때마다 계약금액의 0.1%가 지체상금으로 부과됩니다. ${buildCitationMarker(2)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 손해배상 한도 - 손해배상액은 총 대금 범위 내로 제한됩니다. ${buildCitationMarker(3)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 관할 법원 - 분쟁 시 서울중앙지방법원이 관할입니다. ${buildCitationMarker(4)}`,
      ].join("\n\n");

      const grounded = assertAnswerGrounded(rawAnswer, contextCitations);
      const used = filterCitationsToAnswerUsed(grounded, contextCitations);

      expect(used).toHaveLength(4);
      expect(used.map((c) => c.clauseReference).sort()).toEqual(["제11조", "제17조", "제4조", "제8조"]);
      for (const ordinary of [ordinaryConfidentiality, ordinaryAssignment, ordinaryNotice, ordinaryPurpose]) {
        expect(used.some((c) => c.contractClauseId === ordinary.contractClauseId)).toBe(false);
      }
    });

    it("the conclusion block only needs to summarize count/theme, never repeat each item's own detail, to pass grounding - a [결론] block never requires its own citation marker regardless of how much or little it says", () => {
      const material = clause({ contractClauseId: "c4", clauseReference: "제4조" });
      const shortConclusion = `${ANSWER_BLOCK_TAGS.conclusion} 주의할 조항은 1가지입니다: 중도해지 위약금.`;
      const evidence = `${ANSWER_BLOCK_TAGS.evidence} 중도 해지 시 위약금 10%가 발생합니다. ${buildCitationMarker(1)}`;

      expect(() => assertAnswerGrounded([shortConclusion, evidence].join("\n\n"), [material])).not.toThrow();
    });
  });

  describe("§Citation Identity Canonicalization (Root-Cause Fix) - F. a token only resolves against the EXACT citations array it was generated from", () => {
    it("the same index resolves to a DIFFERENT citation depending on which array it is applied against - the pipeline invariant this protects is that ask-question.ts always resolves a marker against the SAME array (synthesisCitations) it was validated/numbered against, never a broader or different one", () => {
      const contractACitations: Citation[] = [clause({ contractClauseId: "a1", contractId: "contract-a", contractTitle: "계약 A", clauseReference: "제1조" })];
      const contractBCitations: Citation[] = [clause({ contractClauseId: "b1", contractId: "contract-b", contractTitle: "계약 B", clauseReference: "제1조" })];
      const answerText = `내용입니다. ${buildCitationMarker(1)}`;

      const usedAgainstA = filterCitationsToAnswerUsed(answerText, contractACitations);
      const usedAgainstB = filterCitationsToAnswerUsed(answerText, contractBCitations);

      expect(usedAgainstA[0]!.contractClauseId).toBe("a1");
      expect(usedAgainstB[0]!.contractClauseId).toBe("b1");
      // Same literal marker, two entirely different resolved citations -
      // proving identity is array-relative, never a global/portable id, so
      // a caller resolving against the wrong array would silently produce
      // a WRONG (not merely invalid) result. Every real caller
      // (ask-question.ts) is structurally guaranteed to always pass the
      // same `synthesisCitations` array to build/validate/filter - see
      // that module's own trace.
    });
  });

  describe("§AI 답변 품질 개편 Phase 1.4.4 - the skeleton-shaped answer (single opening sentence, N blocks, NO confirmation section) passes grounding cleanly end to end", () => {
    it("exactly one non-enumerating [결론] sentence + N [근거] blocks + NO [확인사항] block - passes grounding and renders exactly N citations, one per selected group", () => {
      const materialA = clause({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "자동 연장." });
      const materialB = clause({ contractClauseId: "c4", clauseReference: "제4조", evidenceText: "중도해지 위약금." });
      const materialC = clause({ contractClauseId: "c6", clauseReference: "제6조", evidenceText: "지연이자." });
      const materialD = clause({ contractClauseId: "c11", clauseReference: "제11조", evidenceText: "책임 제한." });
      const contextCitations: Citation[] = [materialA, materialB, materialC, materialD];

      // The opening sentence names ONLY the count - never enumerates the
      // four issue headlines (requirement 3's own allowed example shape).
      const opening = `${ANSWER_BLOCK_TAGS.conclusion} 눈에 띄는 조건은 4가지입니다.`;
      // materialA..D are contextCitations[0..3].
      const blocks = [
        `${ANSWER_BLOCK_TAGS.evidence} 자동갱신 - 통지가 없으면 1년 연장됩니다. ${buildCitationMarker(1)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 중도해지 위약금 - 해지 시 10% 위약금이 발생합니다. ${buildCitationMarker(2)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 지연이자 - 대금 지연 시 연 12% 이자가 붙습니다. ${buildCitationMarker(3)}`,
        `${ANSWER_BLOCK_TAGS.evidence} 손해배상 한도 - 총 대금 범위로 제한됩니다. ${buildCitationMarker(4)}`,
      ];
      // No [확인사항] block anywhere - "no conclusion section" beyond the one opening sentence.
      const rawAnswer = [opening, ...blocks].join("\n\n");

      expect(rawAnswer).not.toContain(ANSWER_BLOCK_TAGS.action);

      const grounded = assertAnswerGrounded(rawAnswer, contextCitations);
      const used = filterCitationsToAnswerUsed(grounded, contextCitations);

      expect(used).toHaveLength(4);
      expect(used.map((c) => c.clauseReference).sort()).toEqual(["제11조", "제2조", "제4조", "제6조"]);
    });
  });
});
