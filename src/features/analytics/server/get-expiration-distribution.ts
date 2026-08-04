import {
  EXPIRATION_BUCKETS,
  EXPIRATION_BUCKET_LABELS,
  type ExpirationBucket,
} from "@/domain/analytics/date-buckets";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { kstDayIndexToUtcStart, toKstDayIndex } from "@/domain/contracts/get-computed-contract-status";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import { countContractsInDateRange } from "@/server/repositories/analytics-repository";

export interface GetExpirationDistributionParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface ExpirationBucketCount {
  bucket: ExpirationBucket;
  label: string;
  count: number;
}

export interface ExpirationDistribution {
  buckets: ExpirationBucketCount[];
  asOf: string;
  scope: AnalyticsScopeMetadata;
}

function boundsForBucket(bucket: ExpirationBucket, now: Date): { gte?: Date; lt?: Date } | null {
  const day = (offset: number) => kstDayIndexToUtcStart(toKstDayIndex(now) + offset);
  switch (bucket) {
    case "EXPIRED":
      return { lt: day(0) };
    case "TODAY":
      return { gte: day(0), lt: day(1) };
    case "DAYS_1_7":
      return { gte: day(1), lt: day(8) };
    case "DAYS_8_30":
      return { gte: day(8), lt: day(31) };
    case "DAYS_31_90":
      return { gte: day(31), lt: day(91) };
    case "DAYS_91_180":
      return { gte: day(91), lt: day(181) };
    case "DAYS_181_PLUS":
      return { gte: day(181) };
    case "NO_END_DATE":
      return null;
  }
}

/**
 * §9 - dateBasis is Contract.endDate (§2's matrix), and a period filter is
 * intersected WITH each bucket's own endDate range (never replaces it) -
 * e.g. "8~30일" narrowed to a user period becomes "그 기간 내에서 8~30일
 * 이내 만료". contractType/displayStatus/counterpartyId/currency/autoRenewal
 * all narrow every bucket the same way. Every bucket boundary reuses
 * toKstDayIndex/kstDayIndexToUtcStart directly, so it stays aligned with
 * getComputedContractStatus()'s EXPIRING/EXPIRED cutoffs by construction.
 */
export async function getExpirationDistribution(
  params: GetExpirationDistributionParams
): Promise<ExpirationDistribution> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.expiration;
  const period = resolveSectionPeriod(filters, section.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
    endDateFrom: period.from,
    endDateTo: period.to,
  };
  const extraWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const counts = await Promise.all(
    EXPIRATION_BUCKETS.map((bucket) => countContractsInDateRange(organizationId, boundsForBucket(bucket, now), extraWhere))
  );

  return {
    buckets: EXPIRATION_BUCKETS.map((bucket, index) => ({
      bucket,
      label: EXPIRATION_BUCKET_LABELS[bucket],
      count: counts[index] ?? 0,
    })),
    asOf: now.toISOString(),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "endDate",
      periodApplied: period.applied,
      now,
    }),
  };
}
