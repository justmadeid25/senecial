import { describe, expect, it } from "vitest";

import { buildScopeMetadata } from "@/domain/analytics/scope-metadata";

const now = new Date("2026-07-15T12:00:00Z");

describe("buildScopeMetadata (§8 applied/ignored filter split)", () => {
  it("splits present filter keys into applied (supported) and ignored (unsupported)", () => {
    const scope = buildScopeMetadata({
      presentFilterKeys: ["contractType", "signalStatus", "currency"],
      supportedFilterKeys: ["contractType", "currency"],
      periodApplied: false,
      now,
    });
    expect(scope.appliedFilters.sort()).toEqual(["contractType", "currency"]);
    expect(scope.ignoredFilters).toEqual(["signalStatus"]);
  });

  it("never drops an unsupported filter silently - it always appears in ignoredFilters (§8)", () => {
    const scope = buildScopeMetadata({
      presentFilterKeys: ["clauseType"],
      supportedFilterKeys: [],
      periodApplied: false,
      now,
    });
    expect(scope.ignoredFilters).toEqual(["clauseType"]);
  });

  it("produces empty applied/ignored arrays when no filter is present", () => {
    const scope = buildScopeMetadata({
      presentFilterKeys: [],
      supportedFilterKeys: ["contractType"],
      periodApplied: false,
      now,
    });
    expect(scope.appliedFilters).toEqual([]);
    expect(scope.ignoredFilters).toEqual([]);
  });

  it("carries dateBasis/periodApplied/latestRevisionOnly through untouched", () => {
    const scope = buildScopeMetadata({
      presentFilterKeys: [],
      supportedFilterKeys: [],
      dateBasis: "jobCompletedAt",
      periodApplied: true,
      latestRevisionOnly: true,
      now,
    });
    expect(scope.dateBasis).toBe("jobCompletedAt");
    expect(scope.periodApplied).toBe(true);
    expect(scope.latestRevisionOnly).toBe(true);
    expect(scope.generatedAt).toBe(now.toISOString());
  });
});
