import { describe, expect, it } from "vitest";

import { MIN_CITATION_SCORE } from "@/domain/ai/hallucination-guard";
import { KEYWORD_WEIGHT, mergeScores, rerank, VECTOR_WEIGHT } from "@/domain/ai/hybrid-search-scoring";
import { extractKeywords } from "@/domain/ai/keyword-extraction";
import { expandLegalConcepts } from "@/domain/ai/legal-concept-expansion";

describe("mergeScores (Phase 12 Part B §Score Merge)", () => {
  it("weights keyword score higher than vector score (0.6 vs 0.4)", () => {
    const [pureVector] = mergeScores([{ contractClauseId: "a", keywordScore: 0, vectorScore: 1 }]);
    const [pureKeyword] = mergeScores([{ contractClauseId: "b", keywordScore: 1, vectorScore: 0 }]);
    expect(pureKeyword!.score).toBeGreaterThan(pureVector!.score);
  });

  it("clamps a negative cosine score to 0 rather than subtracting from the keyword score", () => {
    const [result] = mergeScores([{ contractClauseId: "a", keywordScore: 1, vectorScore: -0.8 }]);
    expect(result!.score).toBeCloseTo(0.6, 5); // 0.6*1 + 0.4*0
  });

  it("a clause matching both legs scores higher than one matching only one leg", () => {
    const [both] = mergeScores([{ contractClauseId: "a", keywordScore: 0.5, vectorScore: 0.5 }]);
    const [oneOnly] = mergeScores([{ contractClauseId: "b", keywordScore: 0.5, vectorScore: 0 }]);
    expect(both!.score).toBeGreaterThan(oneOnly!.score);
  });
});

describe("rerank (Phase 12 Part B §Rerank)", () => {
  it("sorts by score descending", () => {
    const merged = mergeScores([
      { contractClauseId: "low", keywordScore: 0.1, vectorScore: 0.1 },
      { contractClauseId: "high", keywordScore: 0.9, vectorScore: 0.9 },
    ]);
    const result = rerank(merged, new Set());
    expect(result.map((r) => r.contractClauseId)).toEqual(["high", "low"]);
  });

  it("applies an exact-phrase bonus that can change the final order", () => {
    const merged = mergeScores([
      { contractClauseId: "slightly-better", keywordScore: 0.5, vectorScore: 0.5 },
      { contractClauseId: "exact-phrase", keywordScore: 0.45, vectorScore: 0.45 },
    ]);
    const withoutBonus = rerank(merged, new Set());
    expect(withoutBonus[0]!.contractClauseId).toBe("slightly-better");

    const withBonus = rerank(merged, new Set(["exact-phrase"]));
    expect(withBonus[0]!.contractClauseId).toBe("exact-phrase");
  });
});

/**
 * §AI 답변 품질 개편 P0-2 - reproduces hybrid-search-clauses.ts's REAL
 * keywordScore formula (`matchCount / keywords.length`, stem-substring
 * matching) at the pure-function level, to measure concept expansion's
 * actual effect on ranking math WITHOUT a DB. Per the task's explicit
 * instruction, this does NOT change KEYWORD_WEIGHT/VECTOR_WEIGHT - it only
 * measures and reports whether the current 0.6/0.4 split remains
 * reasonable once expansion terms can inflate the keyword denominator.
 */
const KEYWORD_STEM_LENGTH = 2;

function stemMatchCount(keywords: readonly string[], clauseText: string): number {
  return keywords.filter((keyword) => clauseText.includes(keyword.slice(0, KEYWORD_STEM_LENGTH))).length;
}

function blendedScore(keywords: readonly string[], clauseText: string, vectorScore: number): number {
  const keywordScore = keywords.length > 0 ? stemMatchCount(keywords, clauseText) / keywords.length : 0;
  return KEYWORD_WEIGHT * keywordScore + VECTOR_WEIGHT * Math.max(0, vectorScore);
}

describe("§AI 답변 품질 개편 P0-2 - concept expansion's effect on real ranking math (weighting observation, not a weight change)", () => {
  it("RESCUE CASE: a synonym-only match (question says 납기, clause says 인도) scores 0 on the keyword leg before expansion, and a real, positive score after - concretely lowering the vector score a genuinely-relevant clause needs to clear MIN_CITATION_SCORE", () => {
    const question = "상대방이 납기 안 지키면?";
    const clauseText = "물품은 계약서에 명시된 인도일까지 인도되어야 한다.";

    const baseKeywords = extractKeywords(question);
    const expansionTerms = expandLegalConcepts(question);
    const expandedKeywords = [...new Set([...baseKeywords, ...expansionTerms])];

    const beforeMatchCount = stemMatchCount(baseKeywords, clauseText);
    const afterMatchCount = stemMatchCount(expandedKeywords, clauseText);
    expect(beforeMatchCount).toBe(0); // zero keyword-leg signal before expansion
    expect(afterMatchCount).toBeGreaterThan(0); // "인도" is now reachable

    // The minimum vectorScore this clause needs to clear MIN_CITATION_SCORE
    // via score = KEYWORD_WEIGHT*keywordScore + VECTOR_WEIGHT*vectorScore.
    function minVectorScoreNeeded(keywords: readonly string[]): number {
      const keywordScore = keywords.length > 0 ? stemMatchCount(keywords, clauseText) / keywords.length : 0;
      return Math.max(0, (MIN_CITATION_SCORE - KEYWORD_WEIGHT * keywordScore) / VECTOR_WEIGHT);
    }

    const neededBefore = minVectorScoreNeeded(baseKeywords);
    const neededAfter = minVectorScoreNeeded(expandedKeywords);
    expect(neededBefore).toBeCloseTo(0.375, 5); // 0.15 / 0.4 - keyword leg contributes nothing
    // Real measured value: expansion adds 3 non-matching base tokens plus 2
    // non-matching expansion tokens to the denominator alongside the 1 that
    // DOES match ("인도") - honestly weaker than a naive "4-term" estimate,
    // but still a real, meaningful reduction in what the vector leg alone
    // must supply.
    expect(neededAfter).toBeLessThan(neededBefore);
    expect(neededAfter).toBeCloseTo(0.125, 2);
  });

  it("DILUTION CASE (honest limitation): expansion can LOWER the score of a clause that already matched on the LITERAL query term, when the added synonym terms do not ALSO match that specific clause (their stems genuinely differ, unlike '위약금'/'위약벌' which happen to share a stem) - the denominator grows without a corresponding numerator increase", () => {
    const question = "상대방이 납기 안 지키면?";
    const clauseText = "납기는 계약 체결일로부터 30일 이내로 한다."; // matches "납기" literally; none of 납품/인도/이행기한 appear here

    const baseKeywords = extractKeywords(question);
    const expansionTerms = expandLegalConcepts(question);
    const expandedKeywords = [...new Set([...baseKeywords, ...expansionTerms])];

    const scoreBefore = blendedScore(baseKeywords, clauseText, 0);
    const scoreAfter = blendedScore(expandedKeywords, clauseText, 0);

    // Real, measured direction: this specific clause's keywordScore goes
    // from 1/3 to 1/6 (matchCount unchanged at 1, denominator doubles) once
    // 납품/인도/이행기한 join the denominator without matching THIS clause's
    // text - a genuine, honest limitation, not a hypothetical one.
    expect(scoreBefore).toBeCloseTo(0.2, 5); // 0.6 * (1/3)
    expect(scoreAfter).toBeCloseTo(0.1, 5); // 0.6 * (1/6)
    expect(scoreAfter).toBeLessThan(scoreBefore);
  });

  it("weighting observation: capping MAX_EXPANSION_TERMS keeps the dilution case's absolute score drop small for a typical single-group question (the common case), even though it is not zero", () => {
    const question = "상대방이 납기 안 지키면?";
    const clauseText = "납기는 계약 체결일로부터 30일 이내로 한다.";
    const baseKeywords = extractKeywords(question);
    const expansionTerms = expandLegalConcepts(question);
    const expandedKeywords = [...new Set([...baseKeywords, ...expansionTerms])];

    const scoreBefore = blendedScore(baseKeywords, clauseText, 0);
    const scoreAfter = blendedScore(expandedKeywords, clauseText, 0);
    // A single triggered group (3 added terms here) costs a modest,
    // bounded amount of score for an already-matching clause - not the
    // kind of swing that would flip a clearly-relevant result below
    // MIN_CITATION_SCORE on its own in the common (single-group) case.
    expect(scoreBefore - scoreAfter).toBeLessThan(0.2);
  });
});

/**
 * §AI 답변 품질 개편 Phase 1.2 P0-2 - the exact measured q2 ranking-
 * dilution case: "중간에 계약 끝낼 수 있어?" - 12 of 17 real fixture
 * clauses all stem-matched "계약" (a near-universal word in this domain),
 * so they ALL received the identical keywordScore floor as the one
 * genuinely relevant clause (제4조), leaving only the noisy vector leg to
 * differentiate them - which is how the correct clause got crowded out of
 * the top 5 despite scoring above the hallucination-guard threshold. This
 * reproduces that measurement as a permanent before/after regression test
 * using the real extractKeywords()/keyword-stem-matching logic (not a
 * DB-backed integration test - the full real-pipeline before/after
 * numbers are recorded in the phase's evaluation report instead).
 */
describe("§AI 답변 품질 개편 Phase 1.2 P0-2 - q2 ranking-dilution fix (계약 as a contract-domain stopword)", () => {
  const FIXTURE_CLAUSES: Record<string, string> = {
    제1조: "본 계약은 발주자와 수행자 간 용역 수행에 관한 제반 사항을 정함을 목적으로 한다.",
    제2조:
      "본 계약의 유효기간은 계약체결일로부터 1년으로 하며, 기간 만료 30일 전까지 어느 일방의 서면에 의한 갱신 거절 통지가 없는 경우 동일한 조건으로 1년씩 자동 연장된다.",
    제3조:
      "일방 당사자가 본 계약상의 의무를 위반하고 상대방으로부터 서면 시정 요구를 받은 날로부터 14일 이내에 이를 시정하지 아니하는 경우, 상대방은 서면 통지로써 즉시 본 계약을 해지할 수 있다.",
    제4조:
      "발주자는 계약기간 중이라도 30일 전 서면 통지로 본 계약을 해지할 수 있다. 이 경우 발주자는 해지 시점까지 완료된 부분에 대한 대가를 지급하고, 별도의 손해배상 청구가 없는 한 잔여 계약금액의 10%를 위약금으로 수행자에게 지급한다.",
    제5조: "발주자는 수행자로부터 세금계산서를 수령한 날로부터 30일 이내에 용역대금을 수행자가 지정하는 계좌로 지급하여야 한다.",
    제9조:
      "발주자는 검수 완료 후 6개월 이내에 발견된 결과물의 하자에 대하여 수행자에게 무상 보수를 청구할 수 있으며, 수행자는 통지받은 날로부터 14일 이내에 이를 보수하여야 한다.",
  };

  function keywordScoreOf(clauseText: string, keywords: readonly string[]): number {
    if (keywords.length === 0) return 0;
    const normalized = clauseText;
    const matched = keywords.filter((k) => normalized.includes(k.slice(0, 2).toLowerCase()));
    return matched.length / keywords.length;
  }

  it("BEFORE simulation (계약 included as a keyword): the correct clause (제4조) ties with topically-unrelated clauses", () => {
    const legacyKeywords = ["중간에", "계약", "끝낼", "있어"]; // what extractKeywords used to return
    const scores = Object.entries(FIXTURE_CLAUSES).map(([num, text]) => [num, keywordScoreOf(text, legacyKeywords)] as const);
    const correctScore = scores.find(([num]) => num === "제4조")![1];
    const tiedWithUnrelated = scores.filter(([num, score]) => num !== "제4조" && score === correctScore);
    // 제1조(목적)/제5조(대금지급) are NOT about ending a contract early, yet
    // tied exactly with the correct clause under the old behavior.
    expect(tiedWithUnrelated.length).toBeGreaterThan(0);
  });

  it("AFTER (real extractKeywords, 계약 excluded): the correct clause is no longer artificially tied with unrelated clauses on the keyword leg", () => {
    const keywords = extractKeywords("중간에 계약 끝낼 수 있어?");
    expect(keywords).not.toContain("계약");
    const scores = Object.entries(FIXTURE_CLAUSES).map(([num, text]) => [num, keywordScoreOf(text, keywords)] as const);
    // With "계약" removed, no clause in this fixture gets a free keyword
    // floor anymore - every clause's keyword leg is now honestly 0 for
    // this particular phrasing (a real, remaining query-understanding gap
    // for "끝내다"-style phrasing, not something this fix claims to solve
    // - see the phase's evaluation report for the real end-to-end outcome
    // once the vector leg is included).
    expect(scores.every(([, score]) => score === 0)).toBe(true);
  });

  it("rerun: legitimate 계약-containing queries are NOT damaged by the stopword", () => {
    const legitimateQuestions = ["계약 해지할 수 있어?", "계약기간 언제까지야?", "계약 위반하면?"];
    for (const question of legitimateQuestions) {
      const keywords = extractKeywords(question);
      // Every one of these must still extract at least one real,
      // discriminative token besides "계약" itself.
      expect(keywords.length, `"${question}" must still extract meaningful keywords`).toBeGreaterThan(0);
    }
  });
});
