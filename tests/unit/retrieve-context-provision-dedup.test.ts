import { describe, expect, it, vi } from "vitest";

/**
 * §Citation Identity Canonicalization (Root-Cause Fix) - reproduces the
 * confirmed production UNKNOWN_CITATION_MARKER root cause end to end: the
 * clause retrieval leg and the chunk retrieval leg return the SAME
 * underlying provision under two different clauseReference spellings
 * ("제2조" vs "제2조(해지)"), exactly the shape captured by production
 * telemetry (see the Phase 0 DB verification this task's own spec cites).
 *
 * Both legs (hybrid-search-clauses.ts / hybrid-search-document-chunks.ts)
 * and the comprehensive-mode family-sampling repository are mocked - this
 * test is about retrieveContext()'s OWN merge/dedup/citation-numbering
 * behavior, not about real hybrid search ranking (already covered
 * elsewhere - hybrid-search.test.ts). retrieveContext() itself, the shared
 * citation-provision.ts dedup, buildUserPrompt()'s citation numbering,
 * citation-required.ts's validator, and answer-used-citations.ts's
 * resolution are all exercised for REAL.
 */

vi.mock("@/features/ai/server/hybrid-search-clauses", () => ({ hybridSearchClauses: vi.fn() }));
vi.mock("@/features/ai/server/hybrid-search-document-chunks", () => ({ hybridSearchDocumentChunks: vi.fn() }));
vi.mock("@/server/repositories/clause-family-sample-repository", () => ({
  sampleHighValueClausesForComprehensiveReview: vi.fn(async () => []),
}));

const { hybridSearchClauses } = await import("@/features/ai/server/hybrid-search-clauses");
const { hybridSearchDocumentChunks } = await import("@/features/ai/server/hybrid-search-document-chunks");
const { retrieveContext } = await import("@/features/ai/server/retrieve-context");
const { buildUserPrompt } = await import("@/domain/ai/prompt-builder");
const { buildCitationMarker } = await import("@/domain/ai/citation-marker");
const { assertAnswerGrounded, ANSWER_BLOCK_TAGS } = await import("@/domain/ai/citation-required");
const { filterCitationsToAnswerUsed } = await import("@/domain/ai/answer-used-citations");

const CONTRACT_ID = "contract-prod-repro";
const CONTRACT_TITLE = "[SMOKE] AI Scope Contract";
const QUESTION = "이 계약 해지 조건이 뭐야?";

function mockLegs(params: {
  clauseResults: Array<Partial<Awaited<ReturnType<typeof hybridSearchClauses>>[number]>>;
  chunkResults: Array<Partial<Awaited<ReturnType<typeof hybridSearchDocumentChunks>>[number]>>;
}) {
  vi.mocked(hybridSearchClauses).mockResolvedValue(
    params.clauseResults.map((r, i) => ({
      contractClauseId: `clause-${i}`,
      contractId: CONTRACT_ID,
      contractTitle: CONTRACT_TITLE,
      clauseNumber: null,
      title: null,
      text: `조항 원문 ${i}`,
      score: 0.5,
      keywordScore: 0.5,
      vectorScore: 0.5,
      ...r,
    }))
  );
  vi.mocked(hybridSearchDocumentChunks).mockResolvedValue(
    params.chunkResults.map((r, i) => ({
      chunkId: `chunk-${i}`,
      contractId: CONTRACT_ID,
      contractTitle: CONTRACT_TITLE,
      chunkIndex: i,
      headingContext: null,
      text: `발췌 원문 ${i}`,
      startOffset: 0,
      endOffset: 10,
      sourcePageStart: null,
      sourcePageEnd: null,
      score: 0.4,
      keywordScore: 0.4,
      vectorScore: 0.4,
      ...r,
    }))
  );
}

describe("§Citation Identity Canonicalization - production regression: same provision, two retrieval-leg spellings", () => {
  it("clause leg '제2조' + chunk leg '제2조(해지)' for the SAME contract collapse to exactly ONE citation, clause-preferred, before the prompt is ever built", async () => {
    mockLegs({
      clauseResults: [{ contractClauseId: "clause-real-1", clauseNumber: "제2조", text: "본 계약은 해지될 수 있다.", score: 0.5 }],
      chunkResults: [
        { chunkId: "chunk-real-1", headingContext: "제2조(해지)", text: "본 계약은 해지될 수 있다 - 발췌 원문.", score: 0.4 },
      ],
    });

    const citations = await retrieveContext({ organizationId: "org-1", question: QUESTION, contractId: CONTRACT_ID });

    expect(citations).toHaveLength(1);
    expect(citations[0]!.evidenceType).toBe("clause");
    expect(citations[0]!.contractClauseId).toBe("clause-real-1");
  });

  it("end to end: the single deduped citation gets one token; a two-block answer both citing that token grounds cleanly, resolves to the trusted server Citation object, and renders the correct human-facing label - never AI_GROUNDING_FAILED", async () => {
    mockLegs({
      clauseResults: [{ contractClauseId: "clause-real-1", clauseNumber: "제2조", text: "본 계약은 해지될 수 있다.", score: 0.5 }],
      chunkResults: [
        { chunkId: "chunk-real-1", headingContext: "제2조(해지)", text: "본 계약은 해지될 수 있다 - 발췌 원문.", score: 0.4 },
      ],
    });

    const citations = await retrieveContext({ organizationId: "org-1", question: QUESTION, contractId: CONTRACT_ID });
    expect(citations).toHaveLength(1);

    const prompt = buildUserPrompt(QUESTION, citations);
    expect(prompt).toContain("[CITATION 1]");
    const token = buildCitationMarker(1);

    const rawAnswer = [
      `${ANSWER_BLOCK_TAGS.conclusion} 네, 이 계약은 해지될 수 있습니다.`,
      `${ANSWER_BLOCK_TAGS.evidence} 본 계약은 해지 사유가 있으면 해지될 수 있습니다. ${token}`,
    ].join("\n\n");

    // Must not throw AiGroundingError / not report AI_GROUNDING_FAILED.
    const grounded = assertAnswerGrounded(rawAnswer, citations);
    expect(grounded).toContain("해지될 수 있습니다");

    const used = filterCitationsToAnswerUsed(grounded, citations);
    expect(used).toHaveLength(1);
    // Resolves to the exact trusted server Citation object (by DB identity),
    // never re-derived from any model-authored text.
    expect(used[0]!.contractClauseId).toBe("clause-real-1");
    expect(used[0]!.evidenceType).toBe("clause");
    // The rendered human-facing label is the server's own trusted
    // clauseReference/contractTitle - correct regardless of which of the
    // two legs' original spellings happened to survive dedup.
    expect(used[0]!.clauseReference).toBe("제2조");
    expect(used[0]!.contractTitle).toBe(CONTRACT_TITLE);
  });

  it("D. two genuinely DIFFERENT provisions in the same contract are never merged", async () => {
    mockLegs({
      clauseResults: [
        { contractClauseId: "c2", clauseNumber: "제2조", text: "해지 조항.", score: 0.5 },
        { contractClauseId: "c5", clauseNumber: "제5조", text: "손해배상 조항.", score: 0.4 },
      ],
      chunkResults: [],
    });

    const citations = await retrieveContext({ organizationId: "org-1", question: QUESTION, contractId: CONTRACT_ID });

    expect(citations).toHaveLength(2);
    expect(new Set(citations.map((c) => c.contractClauseId))).toEqual(new Set(["c2", "c5"]));
  });

  it("E. the SAME article number in DIFFERENT contracts is never merged", async () => {
    mockLegs({
      clauseResults: [
        { contractClauseId: "a2", contractId: "contract-a", contractTitle: "계약 A", clauseNumber: "제2조", text: "계약 A 해지 조항.", score: 0.5 },
      ],
      chunkResults: [
        { chunkId: "b2", contractId: "contract-b", contractTitle: "계약 B", headingContext: "제2조", text: "계약 B 해지 발췌.", score: 0.4 },
      ],
    });

    const citations = await retrieveContext({ organizationId: "org-1", question: QUESTION });

    expect(citations).toHaveLength(2);
    expect(new Set(citations.map((c) => c.contractId))).toEqual(new Set(["contract-a", "contract-b"]));
  });
});
