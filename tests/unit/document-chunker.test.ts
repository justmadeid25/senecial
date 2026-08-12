import { describe, expect, it } from "vitest";

import { CHUNK_MAX_TOKENS, CHUNK_TARGET_TOKENS, chunkDocumentText } from "@/domain/ai/document-chunker";

const SAMPLE_CONTRACT = `용역 계약서

제1조(목적)
본 계약은 갑과 을 사이의 용역 제공에 관한 사항을 정함을 목적으로 한다.

제2조(계약기간)
본 계약의 유효기간은 2026년 1월 1일부터 2027년 12월 31일까지로 한다.
단, 계약 종료일 30일 전까지 서면 통지가 없는 경우 자동으로 1년씩 갱신된다.

제3조(대금지급)
을은 매월 말일까지 용역 대금을 갑에게 청구하며, 갑은 청구일로부터 30일 이내에 지급한다.

제9조(비밀유지)
갑과 을은 본 계약의 내용을 제3자에게 누설하지 아니한다.
본 계약은 2028년 12월 31일 종료된다.
`;

describe("chunkDocumentText", () => {
  it("every chunk satisfies documentText.slice(startOffset, endOffset) === text (the one required invariant)", () => {
    const chunks = chunkDocumentText(SAMPLE_CONTRACT);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(SAMPLE_CONTRACT.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
  });

  it("chunkIndex is sequential starting at 0", () => {
    const chunks = chunkDocumentText(SAMPLE_CONTRACT);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("tags each chunk with the nearest preceding article heading", () => {
    const chunks = chunkDocumentText(SAMPLE_CONTRACT);
    const terminationChunk = chunks.find((c) => c.text.includes("2028년 12월 31일"));
    expect(terminationChunk).toBeDefined();
    expect(terminationChunk!.headingContext).toContain("제9조");
  });

  it("returns an empty array for empty/whitespace-only text", () => {
    expect(chunkDocumentText("")).toEqual([]);
    expect(chunkDocumentText("   \n\n  ")).toEqual([]);
  });

  it("a small document stays as a single chunk rather than being split unnecessarily", () => {
    const chunks = chunkDocumentText("제1조(목적)\n짧은 계약서입니다.");
    expect(chunks).toHaveLength(1);
  });

  it("never produces a chunk exceeding CHUNK_MAX_TOKENS except when a single sentence alone is larger (unavoidable)", () => {
    const longParagraph = Array.from({ length: 40 }, (_, i) => `제${i + 1}항의 내용은 상세한 계약 조건을 설명하는 문장입니다.`).join(" ");
    const chunks = chunkDocumentText(`제1조(장문 조항)\n${longParagraph}`);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS + 50);
    }
  });

  it("respects the target token budget - does not create tiny single-paragraph chunks when more content could fit", () => {
    const chunks = chunkDocumentText(SAMPLE_CONTRACT);
    // The whole sample is well under CHUNK_TARGET_TOKENS, so it should
    // collapse into very few chunks, not one chunk per article.
    expect(chunks.length).toBeLessThan(4);
  });

  it("large document produces multiple chunks each within the target token budget (with reasonable headroom for the last paragraph that pushed it over)", () => {
    const manyArticles = Array.from(
      { length: 30 },
      (_, i) => `제${i + 1}조(조항 ${i + 1})\n이것은 조항 ${i + 1}의 상세한 내용을 설명하는 문장입니다. 계약 당사자는 이 조건에 동의합니다.`
    ).join("\n\n");
    const chunks = chunkDocumentText(manyArticles);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 200);
    }
  });
});
