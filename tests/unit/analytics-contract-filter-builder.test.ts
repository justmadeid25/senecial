import { describe, expect, it } from "vitest";

import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { presentFilterKeys, type AnalyticsFilterKey } from "@/domain/analytics/scope-metadata";
import { buildContractAnalyticsWhere } from "@/server/repositories/analytics-filter-builder";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

const now = new Date("2026-07-15T12:00:00+09:00");
const ORG_ID = "org-123";

describe("buildContractAnalyticsWhere (§3 - structural org/deletedAt enforcement)", () => {
  it("always includes organizationId and deletedAt:null as top-level keys", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, {}, now);
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.deletedAt).toBeNull();
  });

  it("organizationId/deletedAt cannot be overridden by filter content - AND array holds only the narrowing conditions", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, { contractType: "SERVICE" }, now);
    expect(where.organizationId).toBe(ORG_ID);
    expect(where.deletedAt).toBeNull();
    expect(Array.isArray(where.AND)).toBe(true);
  });

  it("returns no AND array when no filter is set (empty-filter fast path)", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, {}, now);
    expect(where.AND).toBeUndefined();
  });

  it("adds a contractType condition when set", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, { contractType: "LEASE" }, now);
    expect(where.AND).toContainEqual({ contractType: "LEASE" });
  });

  it("translates displayStatus using the exact same buildDisplayStatusWhere() the contract list uses", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, { displayStatus: "EXPIRING" }, now);
    expect(where.AND).toContainEqual(buildDisplayStatusWhere("EXPIRING", now));
  });

  it("adds a counterpartyId condition when set", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, { counterpartyId: "cp-1" }, now);
    expect(where.AND).toContainEqual({ counterpartyId: "cp-1" });
  });

  it("adds a currency condition when set", () => {
    const where = buildContractAnalyticsWhere(ORG_ID, { currency: "USD" }, now);
    expect(where.AND).toContainEqual({ currency: "USD" });
  });

  it("adds an autoRenewal condition when set, including explicit false", () => {
    expect(buildContractAnalyticsWhere(ORG_ID, { autoRenewal: true }, now).AND).toContainEqual({
      autoRenewal: true,
    });
    expect(buildContractAnalyticsWhere(ORG_ID, { autoRenewal: false }, now).AND).toContainEqual({
      autoRenewal: false,
    });
  });

  it("builds a createdAt range from createdFrom/createdTo", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    const where = buildContractAnalyticsWhere(ORG_ID, { createdFrom: from, createdTo: to }, now);
    expect(where.AND).toContainEqual({ createdAt: { gte: from, lt: to } });
  });

  it("builds an endDate range from endDateFrom/endDateTo, always excluding null endDate", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const where = buildContractAnalyticsWhere(ORG_ID, { endDateFrom: from }, now);
    expect(where.AND).toContainEqual({ endDate: { not: null, gte: from } });
  });

  it("combines multiple filters into separate AND entries (composite filter)", () => {
    const where = buildContractAnalyticsWhere(
      ORG_ID,
      { contractType: "SERVICE", currency: "KRW", autoRenewal: true },
      now
    );
    expect(where.AND).toHaveLength(3);
  });
});

describe("resolveSectionPeriod (§2 per-section default policy)", () => {
  it("'none' policy never applies a period unless explicitly given", () => {
    const result = resolveSectionPeriod({}, "none", now, 12, 60);
    expect(result.applied).toBe(false);
    expect(result.from).toBeUndefined();
  });

  it("'none' policy applies a period once the user explicitly sets one", () => {
    const result = resolveSectionPeriod({ periodStart: new Date("2026-01-01T00:00:00Z") }, "none", now, 12, 60);
    expect(result.applied).toBe(true);
  });

  it("'last12Months' policy always applies, even with no explicit input", () => {
    const result = resolveSectionPeriod({}, "last12Months", now, 12, 60);
    expect(result.applied).toBe(true);
    expect(result.from).toBeInstanceOf(Date);
  });

  it("'fixedWindow' policy never applies a period, even when explicitly given", () => {
    const result = resolveSectionPeriod(
      { periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") },
      "fixedWindow",
      now,
      12,
      60
    );
    expect(result.applied).toBe(false);
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });
});

describe("ANALYTICS_FILTER_MATRIX (§6 single source of truth)", () => {
  const ALL_KEYS: AnalyticsFilterKey[] = [
    "periodStart",
    "periodEnd",
    "contractType",
    "displayStatus",
    "counterpartyId",
    "currency",
    "autoRenewal",
    "clauseType",
    "signalStatus",
    "signalType",
  ];

  it("every section's supportedFilterKeys is a subset of the 10 valid filter keys", () => {
    for (const section of Object.values(ANALYTICS_FILTER_MATRIX)) {
      for (const key of section.supportedFilterKeys) {
        expect(ALL_KEYS).toContain(key);
      }
    }
  });

  it("portfolio/expiration/counterparties/processing default to no period filter (§2's opt-out rows)", () => {
    expect(ANALYTICS_FILTER_MATRIX.portfolio.periodDefault).toBe("none");
    expect(ANALYTICS_FILTER_MATRIX.expiration.periodDefault).toBe("none");
    expect(ANALYTICS_FILTER_MATRIX.counterparties.periodDefault).toBe("none");
    expect(ANALYTICS_FILTER_MATRIX.processing.periodDefault).toBe("none");
  });

  it("only reviewSignals supports the signalStatus/signalType filters", () => {
    for (const [name, section] of Object.entries(ANALYTICS_FILTER_MATRIX)) {
      const keys: readonly string[] = section.supportedFilterKeys;
      const supportsSignalFilters = keys.includes("signalStatus") || keys.includes("signalType");
      if (name === "reviewSignals" || name === "monthlyTrends") {
        continue; // monthlyTrends also aggregates signal counts per month.
      }
      expect(supportsSignalFilters).toBe(false);
    }
  });

  it("monthlyTrends never supports periodStart/periodEnd (fixed window)", () => {
    expect(ANALYTICS_FILTER_MATRIX.monthlyTrends.supportedFilterKeys).not.toContain("periodStart");
    expect(ANALYTICS_FILTER_MATRIX.monthlyTrends.supportedFilterKeys).not.toContain("periodEnd");
  });
});

describe("presentFilterKeys", () => {
  it("returns only the keys that are actually set (not undefined)", () => {
    const keys = presentFilterKeys({ contractType: "SERVICE", currency: undefined, autoRenewal: true });
    expect(keys).toEqual(["contractType", "autoRenewal"]);
  });

  it("returns an empty array for an all-undefined filter object", () => {
    expect(presentFilterKeys({})).toEqual([]);
  });
});
