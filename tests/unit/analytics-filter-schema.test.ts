import { describe, expect, it } from "vitest";

import { analyticsFilterSchema, parseAnalyticsFilters } from "@/lib/validation/analytics";

describe("analyticsFilterSchema / parseAnalyticsFilters (§6 safe defaults)", () => {
  it("parses an entirely empty query into all-undefined filters", () => {
    const filters = parseAnalyticsFilters({});
    expect(filters.contractType).toBeUndefined();
    expect(filters.periodStart).toBeUndefined();
    expect(filters.autoRenewal).toBeUndefined();
  });

  it("drops an invalid contractType instead of throwing", () => {
    const filters = parseAnalyticsFilters({ contractType: "NOT_A_REAL_TYPE" });
    expect(filters.contractType).toBeUndefined();
  });

  it("drops a malformed date instead of throwing", () => {
    const filters = parseAnalyticsFilters({ periodStart: "not-a-date" });
    expect(filters.periodStart).toBeUndefined();
  });

  it("treats an empty-string date filter as unset (matches <input type=date> blank submission)", () => {
    const filters = parseAnalyticsFilters({ periodStart: "" });
    expect(filters.periodStart).toBeUndefined();
  });

  it("parses autoRenewal 'true'/'false' into real booleans, and drops anything else", () => {
    expect(parseAnalyticsFilters({ autoRenewal: "true" }).autoRenewal).toBe(true);
    expect(parseAnalyticsFilters({ autoRenewal: "false" }).autoRenewal).toBe(false);
    expect(parseAnalyticsFilters({ autoRenewal: "maybe" }).autoRenewal).toBeUndefined();
  });

  it("normalizes currency to uppercase and requires exactly 3 letters", () => {
    expect(parseAnalyticsFilters({ currency: "krw" }).currency).toBe("KRW");
    expect(parseAnalyticsFilters({ currency: "KRWX" }).currency).toBeUndefined();
    expect(parseAnalyticsFilters({ currency: "12" }).currency).toBeUndefined();
  });

  it("accepts a valid clauseType/signalStatus/signalType combination", () => {
    const filters = parseAnalyticsFilters({
      clauseType: "PAYMENT",
      signalStatus: "OPEN",
      signalType: "AUTO_RENEWAL_PRESENT",
    });
    expect(filters.clauseType).toBe("PAYMENT");
    expect(filters.signalStatus).toBe("OPEN");
    expect(filters.signalType).toBe("AUTO_RENEWAL_PRESENT");
  });

  it("the underlying schema itself accepts a fully-empty object (safeParse succeeds)", () => {
    expect(analyticsFilterSchema.safeParse({}).success).toBe(true);
  });

  it("regression: submitting the whole filter form (one field set, the other 9 as '') still applies the one set field", () => {
    // This is exactly what a real browser GET-form submission sends - every
    // named input, including the ones the user left on "전체"/blank. Before
    // the Phase 8.1 fix, an empty string failed enum/regex/min(1)
    // validation on non-date fields, which failed the WHOLE Zod object
    // (objects fail if any key fails) and silently fell back to zero
    // filters applied - so picking exactly one filter in the UI appeared to
    // work (URL/chip were correct) while the query silently ignored it.
    const filters = parseAnalyticsFilters({
      periodStart: "",
      periodEnd: "",
      contractType: "SERVICE",
      displayStatus: "",
      counterpartyId: "",
      currency: "",
      autoRenewal: "",
      clauseType: "",
      signalStatus: "",
      signalType: "",
    });
    expect(filters.contractType).toBe("SERVICE");
  });

  it("regression: the same full-form submission works when the set field is displayStatus instead", () => {
    const filters = parseAnalyticsFilters({
      contractType: "",
      displayStatus: "EXPIRING",
      counterpartyId: "",
      currency: "",
      autoRenewal: "",
      clauseType: "",
      signalStatus: "",
      signalType: "",
    });
    expect(filters.displayStatus).toBe("EXPIRING");
  });

  it("regression: the same full-form submission works when the set field is autoRenewal instead", () => {
    const filters = parseAnalyticsFilters({
      contractType: "",
      displayStatus: "",
      counterpartyId: "",
      currency: "",
      autoRenewal: "true",
      clauseType: "",
      signalStatus: "",
      signalType: "",
    });
    expect(filters.autoRenewal).toBe(true);
  });
});
