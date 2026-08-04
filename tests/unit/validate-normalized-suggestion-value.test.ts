import { describe, expect, it } from "vitest";

import { isValidNormalizedSuggestionValue } from "@/domain/extraction/validate-normalized-suggestion-value";

describe("isValidNormalizedSuggestionValue", () => {
  it("accepts a well-formed date value", () => {
    expect(isValidNormalizedSuggestionValue("startDate", { value: "2026-08-01" })).toBe(true);
  });

  it("rejects a malformed date value", () => {
    expect(isValidNormalizedSuggestionValue("startDate", { value: "2026/08/01" })).toBe(false);
  });

  it("accepts a well-formed amount value", () => {
    expect(isValidNormalizedSuggestionValue("amount", { value: "100000000" })).toBe(true);
  });

  it("rejects an amount value with a currency symbol embedded", () => {
    expect(isValidNormalizedSuggestionValue("amount", { value: "₩100,000,000" })).toBe(false);
  });

  it("accepts a well-formed 3-letter currency code", () => {
    expect(isValidNormalizedSuggestionValue("currency", { value: "KRW" })).toBe(true);
  });

  it("rejects a lowercase or malformed currency code", () => {
    expect(isValidNormalizedSuggestionValue("currency", { value: "krw" })).toBe(false);
    expect(isValidNormalizedSuggestionValue("currency", { value: "KR" })).toBe(false);
  });

  it("accepts a boolean autoRenewal value", () => {
    expect(isValidNormalizedSuggestionValue("autoRenewal", { value: true })).toBe(true);
  });

  it("rejects a non-boolean autoRenewal value", () => {
    expect(isValidNormalizedSuggestionValue("autoRenewal", { value: "true" })).toBe(false);
  });

  it("accepts an in-range noticePeriodDays integer", () => {
    expect(isValidNormalizedSuggestionValue("noticePeriodDays", { value: 30 })).toBe(true);
  });

  it("rejects an out-of-range or non-integer noticePeriodDays", () => {
    expect(isValidNormalizedSuggestionValue("noticePeriodDays", { value: -1 })).toBe(false);
    expect(isValidNormalizedSuggestionValue("noticePeriodDays", { value: 3651 })).toBe(false);
    expect(isValidNormalizedSuggestionValue("noticePeriodDays", { value: 1.5 })).toBe(false);
  });

  it("accepts a real ContractType enum value", () => {
    expect(isValidNormalizedSuggestionValue("contractType", { value: "LEASE" })).toBe(true);
  });

  it("rejects an unmapped contractType value", () => {
    expect(isValidNormalizedSuggestionValue("contractType", { value: "UNKNOWN" })).toBe(false);
  });

  it("accepts a non-empty bounded string field", () => {
    expect(isValidNormalizedSuggestionValue("title", { value: "사무실 임대차계약" })).toBe(true);
  });

  it("rejects an empty string field", () => {
    expect(isValidNormalizedSuggestionValue("title", { value: "" })).toBe(false);
    expect(isValidNormalizedSuggestionValue("title", { value: "   " })).toBe(false);
  });

  it("rejects an over-length string field", () => {
    expect(isValidNormalizedSuggestionValue("title", { value: "x".repeat(501) })).toBe(false);
  });

  it("accepts a counterpartyName suggestion shaped as { name }", () => {
    expect(isValidNormalizedSuggestionValue("counterpartyName", { name: "감마파트너스" })).toBe(
      true
    );
  });

  it("rejects a counterpartyName suggestion missing the name field", () => {
    expect(isValidNormalizedSuggestionValue("counterpartyName", { value: "감마파트너스" })).toBe(
      false
    );
  });

  it("rejects a null or non-object normalizedValue", () => {
    expect(isValidNormalizedSuggestionValue("title", null)).toBe(false);
    expect(isValidNormalizedSuggestionValue("title", "사무실 임대차계약")).toBe(false);
    expect(isValidNormalizedSuggestionValue("title", undefined)).toBe(false);
  });

  it("strips a disallowed/unrecognized fieldKey (defense in depth against a future provider sending userId, status, etc.)", () => {
    expect(
      isValidNormalizedSuggestionValue(
        // Cast through unknown since the real type only permits allowlisted
        // keys - this simulates an untrusted provider response bypassing
        // the TypeScript type at the JSON boundary.
        "organizationId" as unknown as Parameters<typeof isValidNormalizedSuggestionValue>[0],
        { value: "some-org-id" }
      )
    ).toBe(false);
  });
});
