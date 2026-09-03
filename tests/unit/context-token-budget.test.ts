import { describe, expect, it } from "vitest";

import type { ClauseCitation } from "@/domain/ai/citation";
import { countTokens, MAX_CITATIONS_FOCUSED, packCitationsWithinTokenBudget } from "@/domain/ai/context-token-budget";

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

describe("packCitationsWithinTokenBudget (Phase 14.1 §5)", () => {
  it("keeps every citation and reports no truncation when comfortably under budget", () => {
    const citations = [
      buildCitation({ contractClauseId: "c1", clauseReference: "제1조", evidenceText: "첫 번째 근거 문장." }),
      buildCitation({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "두 번째 근거 문장." }),
      buildCitation({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "세 번째 근거 문장." }),
    ];
    const result = packCitationsWithinTokenBudget("질문", citations);
    expect(result.truncated).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.kept).toHaveLength(3);
    expect(result.totalContextTokens).toBeGreaterThan(0);
  });

  it("token budget alone (not count) is still the only bound for a COMPREHENSIVE question - many small citations can all fit if real token size allows it", () => {
    const citations = Array.from({ length: 30 }, (_, i) =>
      buildCitation({ contractClauseId: `c${i}`, clauseReference: `제${i}조`, evidenceText: `짧은 근거 문장 ${i}.` })
    );
    // 30 tiny citations comfortably fit the real default budget - proves
    // there is no fixed token-size ceiling for a comprehensive review, only
    // the count cap below (which only applies to `focused`).
    const result = packCitationsWithinTokenBudget("질문", citations, undefined, "comprehensive");
    expect(result.kept).toHaveLength(30);
    expect(result.truncated).toBe(false);
  });

  describe("§AI 답변 품질 개편 Phase 1.1 P0-5 - citation-count cap for focused questions", () => {
    function manyCitations(count: number) {
      return Array.from({ length: count }, (_, i) =>
        buildCitation({ contractClauseId: `c${i}`, clauseReference: `제${i}조`, evidenceText: `짧은 근거 문장 ${i}.`, score: 1 - i * 0.01 })
      );
    }

    it("a focused question (the default) never packs more than MAX_CITATIONS_FOCUSED, even with huge token headroom - the exact measured evaluation regression (12-14 citations for a single-fact question)", () => {
      const result = packCitationsWithinTokenBudget("질문", manyCitations(14));
      expect(result.kept.length).toBeLessThanOrEqual(MAX_CITATIONS_FOCUSED);
      expect(result.truncated).toBe(true);
    });

    it("explicit complexity='focused' behaves identically to the default", () => {
      const result = packCitationsWithinTokenBudget("질문", manyCitations(14), undefined, "focused");
      expect(result.kept.length).toBeLessThanOrEqual(MAX_CITATIONS_FOCUSED);
    });

    it("the count cap keeps the STRONGEST citations (already score-sorted input), not an arbitrary subset", () => {
      const result = packCitationsWithinTokenBudget("질문", manyCitations(10));
      expect(result.kept.map((c) => c.contractClauseId)).toEqual(
        Array.from({ length: MAX_CITATIONS_FOCUSED }, (_, i) => `c${i}`)
      );
    });

    it("a focused question with FEWER than the cap is never artificially padded or truncated", () => {
      const result = packCitationsWithinTokenBudget("질문", manyCitations(3));
      expect(result.kept).toHaveLength(3);
      expect(result.truncated).toBe(false);
    });

    it("real scenario: a termination question's top-2 citations (the termination right + a materially relevant early-termination/penalty qualifier) both survive the cap alongside less-relevant noise", () => {
      const citations = [
        buildCitation({ contractClauseId: "art4", clauseReference: "제4조", evidenceText: "중도해지 시 위약금을 지급한다.", score: 0.51 }),
        buildCitation({ contractClauseId: "art3", clauseReference: "제3조", evidenceText: "계약 위반 시 즉시 해지할 수 있다.", score: 0.44 }),
        buildCitation({ contractClauseId: "art12", clauseReference: "제12조", evidenceText: "비밀유지 의무가 있다.", score: 0.27 }),
        buildCitation({ contractClauseId: "art16", clauseReference: "제16조", evidenceText: "불가항력 시 책임을 지지 않는다.", score: 0.26 }),
        buildCitation({ contractClauseId: "art2", clauseReference: "제2조", evidenceText: "계약기간은 1년이다.", score: 0.25 }),
        buildCitation({ contractClauseId: "art17", clauseReference: "제17조", evidenceText: "서울중앙지방법원을 관할로 한다.", score: 0.22 }),
      ];
      const result = packCitationsWithinTokenBudget("이거 그냥 해지해도 돼?", citations);
      const kept = result.kept.map((c) => c.contractClauseId);
      expect(kept).toContain("art4");
      expect(kept).toContain("art3");
      expect(kept.length).toBeLessThanOrEqual(MAX_CITATIONS_FOCUSED);
    });
  });

  it("truncates by real token size (not item count) when over an explicit small budget, keeping the highest-scored (first) citations", () => {
    const citations = [
      buildCitation({ contractClauseId: "c1", clauseReference: "제1조", evidenceText: "가".repeat(200) }),
      buildCitation({ contractClauseId: "c2", clauseReference: "제2조", evidenceText: "나".repeat(200) }),
      buildCitation({ contractClauseId: "c3", clauseReference: "제3조", evidenceText: "다".repeat(200) }),
    ];
    // A real (not guessed) budget: exactly enough for the first citation
    // alone (measured via an unbounded run), never enough for two - the
    // system prompt + wrapper overhead alone is far larger than any of
    // these evidence strings, so a budget has to be derived from an
    // actual measurement, not from the evidence text's own size.
    const oneCitationTokens = packCitationsWithinTokenBudget("질문", [citations[0]!]).totalContextTokens;
    const result = packCitationsWithinTokenBudget("질문", citations, oneCitationTokens);
    expect(result.truncated).toBe(true);
    expect(result.kept.length).toBeLessThan(3);
    expect(result.kept.map((c) => c.contractClauseId)).toEqual(["c1"]);
  });

  it("skips a single oversized citation rather than stopping - a later, smaller citation still gets packed in", () => {
    const small = buildCitation({ contractClauseId: "small", clauseReference: "제2조", evidenceText: "작은 근거.", score: 0.5 });
    const huge = buildCitation({ contractClauseId: "huge", clauseReference: "제1조", evidenceText: "매".repeat(5000), score: 0.99 });
    // Real budget: enough for the small citation alone, never enough for
    // the huge one (measured, not guessed, for the same reason as above).
    const smallAloneTokens = packCitationsWithinTokenBudget("질문", [small]).totalContextTokens;
    const result = packCitationsWithinTokenBudget("질문", [huge, small], smallAloneTokens);
    expect(result.kept.map((c) => c.contractClauseId)).toEqual(["small"]);
    expect(result.truncated).toBe(true);
  });

  it("de-duplicates by normalized evidence text across citations (e.g. a clause citation and a chunk citation covering the same passage), keeping the first/highest-scored", () => {
    const citations = [
      buildCitation({ contractClauseId: "clause-a", evidenceText: "동일한   근거 문장입니다.", score: 0.9 }),
      buildCitation({ contractClauseId: "chunk-a", evidenceText: "동일한 근거 문장입니다.", score: 0.7 }),
    ];
    const result = packCitationsWithinTokenBudget("질문", citations);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.contractClauseId).toBe("clause-a");
  });

  it("never mutates the input array", () => {
    const citations = [buildCitation({ contractClauseId: "c1" }), buildCitation({ contractClauseId: "c2" })];
    const original = [...citations];
    packCitationsWithinTokenBudget("질문", citations);
    expect(citations).toEqual(original);
  });

  it("returns zero kept citations for an empty input, without throwing", () => {
    const result = packCitationsWithinTokenBudget("질문", []);
    expect(result.kept).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.droppedCount).toBe(0);
  });
});

describe("countTokens (Phase 14.1 §5)", () => {
  it("returns a real, nonzero token count for non-empty text", () => {
    expect(countTokens("계약을 해지하려면 어떻게 해야 하나요?")).toBeGreaterThan(0);
  });

  it("returns 0 for empty text", () => {
    expect(countTokens("")).toBe(0);
  });

  it("scales with text length, not a fixed constant", () => {
    const short = countTokens("짧은 문장.");
    const long = countTokens("훨씬 더 긴 문장입니다. ".repeat(50));
    expect(long).toBeGreaterThan(short * 10);
  });
});
