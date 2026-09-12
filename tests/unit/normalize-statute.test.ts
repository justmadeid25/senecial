import { describe, expect, it } from "vitest";

import { buildStatuteFragments, normalizeStatuteSource } from "@/domain/legal";
import type { StatuteBodyFetchResult } from "@/domain/legal";

const fetchResult: StatuteBodyFetchResult = {
  officialLawId: "001234",
  lawName: "민법",
  lawType: "법률",
  promulgationDate: "19580222",
  effectiveDate: "19600101",
  ministry: "법무부",
  sourceUrl: "https://www.law.go.kr/법령/민법",
  articles: [
    { articleNumber: "397", articleSubNumber: null, articleTitle: "이자채무", content: "제397조(이자채무) ..." },
    { articleNumber: "398", articleSubNumber: null, articleTitle: "배상액의 예정", content: "제398조(배상액의 예정) ① 당사자는 ..." },
    { articleNumber: "398", articleSubNumber: "2", articleTitle: "위약금", content: "제398조의2(위약금) ..." },
  ],
  fullText: "제397조(이자채무) ...\n\n제398조(배상액의 예정) ① 당사자는 ...\n\n제398조의2(위약금) ...",
};

describe("buildStatuteFragments (Phase L1 §3 - article-level pinpoint fragments)", () => {
  it("produces one fragment per official article unit, in order, with a proper label", () => {
    const fragments = buildStatuteFragments(fetchResult.articles);
    expect(fragments).toHaveLength(3);
    expect(fragments[0]!.label).toBe("제397조(이자채무)");
    expect(fragments[2]!.label).toBe("제398조의2(위약금)");
    expect(fragments.map((f) => f.fragmentIndex)).toEqual([0, 1, 2]);
  });
});

describe("normalizeStatuteSource (Phase L1 §2/§3)", () => {
  it("normalizes the whole law body when no article is requested", () => {
    const source = normalizeStatuteSource({ fetchResult, retrievedAt: new Date("2026-01-01T00:00:00Z") });
    expect(source.identity.articleId).toBeNull();
    expect(source.citationLabel).toBe("민법");
    expect(source.content).toBe(fetchResult.fullText);
    expect(source.fragments).toHaveLength(3);
    expect(source.bodyFetchSucceeded).toBe(true);
  });

  it("narrows to a single requested article, including its sub-number in identity", () => {
    const source = normalizeStatuteSource({ fetchResult, requestedArticleId: "398-2", retrievedAt: new Date() });
    expect(source.identity.articleId).toBe("398-2");
    expect(source.content).toBe("제398조의2(위약금) ...");
    expect(source.citationLabel).toBe("민법 제398조의2(위약금)");
    expect(source.articleNumber).toBe("398");
    expect(source.articleTitle).toBe("위약금");
  });

  it("matches a plain article number request against the article with no sub-number", () => {
    const source = normalizeStatuteSource({ fetchResult, requestedArticleId: "398", retrievedAt: new Date() });
    expect(source.identity.articleId).toBe("398");
    expect(source.content).toBe("제398조(배상액의 예정) ① 당사자는 ...");
  });

  it("produces a deterministic contentHash for identical content across two normalization calls", () => {
    const first = normalizeStatuteSource({ fetchResult, requestedArticleId: "397", retrievedAt: new Date() });
    const second = normalizeStatuteSource({ fetchResult, requestedArticleId: "397", retrievedAt: new Date() });
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("falls back to the whole law when the requested article does not exist in the fetched body", () => {
    const source = normalizeStatuteSource({ fetchResult, requestedArticleId: "999", retrievedAt: new Date() });
    expect(source.identity.articleId).toBeNull();
    expect(source.content).toBe(fetchResult.fullText);
  });
});
