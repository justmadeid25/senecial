/**
 * §8 - every analytics query result carries this alongside its data so the
 * UI never has to guess what was actually applied. `ignoredFilters` is
 * never hidden by the UI (§8's explicit instruction) - a filter set by the
 * user that this section doesn't support is always surfaced, not silently
 * dropped.
 */
export interface AnalyticsScopeMetadata {
  appliedFilters: string[];
  ignoredFilters: string[];
  dateBasis?: "createdAt" | "endDate" | "jobCompletedAt" | "signalCreatedAt" | "jobCreatedAt" | "fixedWindow";
  /** Whether a period filter narrows this section at all, and if so whether it defaults to the last N months or only applies when explicitly given. */
  periodApplied: boolean;
  latestRevisionOnly?: boolean;
  generatedAt: string;
}

export type AnalyticsFilterKey =
  | "periodStart"
  | "periodEnd"
  | "contractType"
  | "displayStatus"
  | "counterpartyId"
  | "currency"
  | "autoRenewal"
  | "clauseType"
  | "signalStatus"
  | "signalType";

/** Builds the applied/ignored split for a section given which filter keys it supports and which the user actually set. */
export function buildScopeMetadata(params: {
  presentFilterKeys: AnalyticsFilterKey[];
  supportedFilterKeys: readonly AnalyticsFilterKey[];
  dateBasis?: AnalyticsScopeMetadata["dateBasis"];
  periodApplied: boolean;
  latestRevisionOnly?: boolean;
  now: Date;
}): AnalyticsScopeMetadata {
  const supported = new Set<string>(params.supportedFilterKeys);
  const applied: string[] = [];
  const ignored: string[] = [];
  for (const key of params.presentFilterKeys) {
    if (supported.has(key)) {
      applied.push(key);
    } else {
      ignored.push(key);
    }
  }
  return {
    appliedFilters: applied,
    ignoredFilters: ignored,
    dateBasis: params.dateBasis,
    periodApplied: params.periodApplied,
    latestRevisionOnly: params.latestRevisionOnly,
    generatedAt: params.now.toISOString(),
  };
}

/** The filter keys actually present (not undefined) in a parsed AnalyticsFilterInput - used as buildScopeMetadata()'s presentFilterKeys. */
export function presentFilterKeys(filters: Record<string, unknown>): AnalyticsFilterKey[] {
  const allKeys: AnalyticsFilterKey[] = [
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
  return allKeys.filter((key) => filters[key] !== undefined);
}
