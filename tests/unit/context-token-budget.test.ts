import { describe, expect, it } from "vitest";

import type { ClauseCitation } from "@/domain/ai/citation";
import { countTokens, packCitationsWithinTokenBudget } from "@/domain/ai/context-token-budget";

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

  it("does not cap at any fixed evidence COUNT - many small citations can all fit if the real token budget allows it", () => {
    const citations = Array.from({ length: 30 }, (_, i) =>
      buildCitation({ contractClauseId: `c${i}`, clauseReference: `제${i}조`, evidenceText: `짧은 근거 문장 ${i}.` })
    );
    // 30 tiny citations comfortably fit the real default budget - proves
    // there is no fixed "8 items max" ceiling anymore.
    const result = packCitationsWithinTokenBudget("질문", citations);
    expect(result.kept).toHaveLength(30);
    expect(result.truncated).toBe(false);
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
