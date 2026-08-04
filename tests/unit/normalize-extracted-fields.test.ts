import { describe, expect, it } from "vitest";

import {
  normalizeAmount,
  normalizeBoolean,
  normalizeContractType,
  normalizeCurrencyCode,
  normalizeDate,
} from "@/domain/extraction/normalize-extracted-fields";

describe("normalizeDate", () => {
  it("accepts ISO format (YYYY-MM-DD)", () => {
    expect(normalizeDate("2026-08-01")).toEqual({ isoDate: "2026-08-01" });
  });

  it("accepts ISO format with single-digit month/day and pads them", () => {
    expect(normalizeDate("2026-8-1")).toEqual({ isoDate: "2026-08-01" });
  });

  it("accepts dot-separated format", () => {
    expect(normalizeDate("2026.08.01")).toEqual({ isoDate: "2026-08-01" });
    expect(normalizeDate("2026.08.01.")).toEqual({ isoDate: "2026-08-01" });
  });

  it("accepts Korean-language date format", () => {
    expect(normalizeDate("2026년 8월 1일")).toEqual({ isoDate: "2026-08-01" });
  });

  it("rejects an ambiguous slash format rather than guessing month/day order", () => {
    expect(normalizeDate("08/01/2026")).toBeNull();
  });

  it("rejects an invalid calendar date", () => {
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("2026-13-01")).toBeNull();
  });

  it("rejects plain garbage text", () => {
    expect(normalizeDate("계약 체결일 미정")).toBeNull();
  });
});

describe("normalizeCurrencyCode", () => {
  it("accepts an existing 3-letter ISO code", () => {
    expect(normalizeCurrencyCode("KRW")).toBe("KRW");
    expect(normalizeCurrencyCode("usd")).toBe("USD");
  });

  it("maps currency symbols to ISO codes", () => {
    expect(normalizeCurrencyCode("₩100,000,000")).toBe("KRW");
    expect(normalizeCurrencyCode("$500")).toBe("USD");
    expect(normalizeCurrencyCode("¥1000")).toBe("JPY");
    expect(normalizeCurrencyCode("€200")).toBe("EUR");
  });

  it("recognizes 원 or KRW as Korean won", () => {
    expect(normalizeCurrencyCode("100,000,000원")).toBe("KRW");
  });

  it("returns null when no currency signal is present", () => {
    expect(normalizeCurrencyCode("500")).toBeNull();
  });
});

describe("normalizeAmount", () => {
  it("extracts digits and strips comma grouping", () => {
    expect(normalizeAmount("₩100,000,000")).toEqual({ amount: "100000000", currency: "KRW" });
  });

  it("extracts a plain numeric amount with no currency signal", () => {
    expect(normalizeAmount("8000000")).toEqual({ amount: "8000000", currency: undefined });
  });

  it("parses the Korean legal-numeral wrapper '금 ...원정' (required example)", () => {
    expect(normalizeAmount("금 일억원정")).toEqual({ amount: "100000000", currency: "KRW" });
  });

  it("parses a compound Korean numeral (억 + 만 units)", () => {
    expect(normalizeAmount("금 일억이천만원정")).toEqual({ amount: "120000000", currency: "KRW" });
  });

  it("parses a Korean numeral without the 금/원정 wrapper", () => {
    expect(normalizeAmount("오천만원")).toEqual({ amount: "50000000", currency: "KRW" });
  });

  it("never produces a value through JS number arithmetic (string-only precision)", () => {
    // A value large enough that float precision would be a concern if it
    // were routed through a JS number - must still round-trip exactly as a
    // string (and stays within amountSchema's 12-digit cap).
    const result = normalizeAmount("금 오백억원정");
    expect(result?.amount).toBe("50000000000");
    expect(typeof result?.amount).toBe("string");
  });

  it("returns null when the parsed Korean numeral exceeds the 12-digit amount cap", () => {
    expect(normalizeAmount("금 일조원정")).toBeNull();
  });

  it("returns null for text with no recognizable numeral", () => {
    expect(normalizeAmount("협의 후 결정")).toBeNull();
  });

  it("returns null for an amount exceeding the allowed shape (too many digits)", () => {
    expect(normalizeAmount("1234567890123")).toBeNull();
  });
});

describe("normalizeBoolean", () => {
  it("recognizes Korean/English true tokens", () => {
    expect(normalizeBoolean("예")).toBe(true);
    expect(normalizeBoolean("네")).toBe(true);
    expect(normalizeBoolean("있음")).toBe(true);
    expect(normalizeBoolean("yes")).toBe(true);
    expect(normalizeBoolean("Y")).toBe(true);
  });

  it("recognizes Korean/English false tokens", () => {
    expect(normalizeBoolean("아니오")).toBe(false);
    expect(normalizeBoolean("없음")).toBe(false);
    expect(normalizeBoolean("no")).toBe(false);
    expect(normalizeBoolean("N")).toBe(false);
  });

  it("returns null for unrecognized text (never guesses)", () => {
    expect(normalizeBoolean("잘 모르겠음")).toBeNull();
  });
});

describe("normalizeContractType", () => {
  it("accepts an exact enum key (case-insensitive)", () => {
    expect(normalizeContractType("lease")).toBe("LEASE");
    expect(normalizeContractType("NDA")).toBe("NDA");
  });

  it("accepts an exact Korean label match", () => {
    expect(normalizeContractType("임대차계약")).toBe("LEASE");
  });

  it("returns null for an unmapped value rather than guessing", () => {
    expect(normalizeContractType("무슨 계약인지 모름")).toBeNull();
  });
});
