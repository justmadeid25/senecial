import { describe, expect, it } from "vitest";

import { DeterministicKoreanClauseSegmenter } from "@/server/services/clauses/deterministic-korean-clause-segmenter";

const SAMPLE_TEXT = [
  "사무실 임대차계약서",
  "",
  "제1조(목적)",
  "본 계약은 임대인과 임차인 간의 사무실 임대차에 관한 사항을 정함을 목적으로 한다.",
  "",
  "제2조(계약기간)",
  "본 계약의 계약기간은 2026년 8월 1일부터 2027년 7월 31일까지로 한다.",
  "",
  "제3조(비밀유지)",
  "양 당사자는 상대방의 비밀 정보를 제3자에게 누설하여서는 안 된다.",
].join("\n");

describe("DeterministicKoreanClauseSegmenter", () => {
  it("splits the document into one clause per 제N조 marker", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });

    // A preamble clause (the title line before 제1조) plus 3 numbered clauses.
    expect(result.clauses).toHaveLength(4);
    expect(result.clauses.map((c) => c.clauseNumber)).toEqual([
      undefined,
      "제1조",
      "제2조",
      "제3조",
    ]);
  });

  it("does not duplicate the clause-number header line inside the clause body text (regression)", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });

    const article1 = result.clauses.find((c) => c.clauseNumber === "제1조");
    expect(article1?.text).not.toContain("제1조");
    expect(article1?.text).toContain("본 계약은 임대인과 임차인");
  });

  it("captures the parenthesized title separately from clauseNumber", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });

    const article1 = result.clauses.find((c) => c.clauseNumber === "제1조");
    expect(article1?.title).toBe("목적");
  });

  it("produces offsets that are an exact substring match against the input text", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });

    for (const clause of result.clauses) {
      expect(SAMPLE_TEXT.slice(clause.startOffset, clause.endOffset)).toBe(clause.text);
    }
    for (const section of result.sections) {
      expect(SAMPLE_TEXT.slice(section.startOffset, section.endOffset)).toBe(section.text);
    }
  });

  it("does not misread a date inside a clause as a new clause boundary", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });

    const article2 = result.clauses.find((c) => c.clauseNumber === "제2조");
    expect(article2?.text).toContain("2026년 8월 1일부터 2027년 7월 31일까지");
    // The date must not have split 제2조 into an extra clause - only the
    // implicit preamble plus the 3 real articles should exist.
    expect(result.clauses.filter((c) => c.depth === 0)).toHaveLength(4);
  });

  it("flattens depth to 0 when no 제N조 markers are found at all", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const noArticleText = ["1. 첫 번째 항목", "가. 세부 사항", "2. 두 번째 항목"].join("\n");
    const result = await segmenter.segment({ text: noArticleText, locale: "ko-KR" });

    expect(result.clauses.every((clause) => clause.depth === 0)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("reports its method and version", async () => {
    const segmenter = new DeterministicKoreanClauseSegmenter();
    const result = await segmenter.segment({ text: SAMPLE_TEXT, locale: "ko-KR" });
    expect(result.method).toBe("deterministic-korean-rules");
    expect(result.version.length).toBeGreaterThan(0);
  });
});
