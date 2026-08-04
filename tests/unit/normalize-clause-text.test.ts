import { describe, expect, it } from "vitest";

import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";

describe("normalizeClauseText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeClauseText("  본문 내용  ")).toBe("본문 내용");
  });

  it("collapses consecutive spaces/tabs into a single space", () => {
    expect(normalizeClauseText("본문   내용\t\t입니다")).toBe("본문 내용 입니다");
  });

  it("normalizes CRLF to LF", () => {
    expect(normalizeClauseText("첫 줄\r\n둘째 줄")).toBe("첫 줄\n둘째 줄");
  });

  it("collapses multiple blank lines into one", () => {
    expect(normalizeClauseText("첫 줄\n\n\n둘째 줄")).toBe("첫 줄\n둘째 줄");
  });

  it("unifies smart quotes to straight quotes", () => {
    expect(normalizeClauseText("‘인용’과 “인용”")).toBe("'인용'과 \"인용\"");
  });

  it("lowercases latin characters", () => {
    expect(normalizeClauseText("Force Majeure 조항")).toBe("force majeure 조항");
  });

  it("never mutates the input string (returns a new value)", () => {
    const input = "  원본  ";
    const result = normalizeClauseText(input);
    expect(input).toBe("  원본  ");
    expect(result).not.toBe(input);
  });
});
