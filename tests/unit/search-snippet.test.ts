import { describe, expect, it } from "vitest";

import { buildSearchSnippet } from "@/domain/clauses/search-snippet";

describe("buildSearchSnippet", () => {
  it("returns null when the query is empty", () => {
    expect(buildSearchSnippet("본문 텍스트", "")).toBeNull();
  });

  it("returns null when the query is not found in the text", () => {
    expect(buildSearchSnippet("본문 텍스트", "존재하지않는단어")).toBeNull();
  });

  it("splits the text into before/match/after around the query", () => {
    const result = buildSearchSnippet("이것은 비밀유지 조항입니다.", "비밀유지");
    expect(result).not.toBeNull();
    expect(result!.match).toBe("비밀유지");
    expect(result!.before + result!.match + result!.after).toContain("비밀유지");
  });

  it("is case-insensitive", () => {
    const result = buildSearchSnippet("Force Majeure clause", "force majeure");
    expect(result?.match.toLowerCase()).toBe("force majeure");
  });

  it("prefixes with an ellipsis when the match is not at the start", () => {
    const longText = "x".repeat(200) + "비밀유지" + "y".repeat(200);
    const result = buildSearchSnippet(longText, "비밀유지", 20);
    expect(result?.before.startsWith("…")).toBe(true);
    expect(result?.after.endsWith("…")).toBe(true);
  });

  it("does not prefix with an ellipsis when the match is at the very start", () => {
    const result = buildSearchSnippet("비밀유지 조항입니다", "비밀유지");
    expect(result?.before.startsWith("…")).toBe(false);
  });

  it("caps the total snippet length even with a large window", () => {
    const longText = "x".repeat(500) + "검색어" + "y".repeat(500);
    const result = buildSearchSnippet(longText, "검색어", 400);
    const total = (result?.before.length ?? 0) + (result?.match.length ?? 0) + (result?.after.length ?? 0);
    expect(total).toBeLessThanOrEqual(200);
  });

  it("never returns raw HTML - the caller renders three plain text parts", () => {
    const result = buildSearchSnippet("<script>비밀유지</script>", "비밀유지");
    expect(result?.before).not.toContain("<mark>");
    expect(result?.match).toBe("비밀유지");
  });
});
