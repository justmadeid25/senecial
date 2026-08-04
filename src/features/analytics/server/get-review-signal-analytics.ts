import { ClauseReviewSignalStatus, ClauseReviewSignalType } from "@/generated/prisma/enums";
import {
  STALE_SIGNAL_BUCKETS,
  STALE_SIGNAL_BUCKET_LABELS,
  staleSignalBucketForAge,
  type StaleSignalBucket,
} from "@/domain/analytics/date-buckets";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  distinctContractCountForSignalType,
  findOpenReviewSignalAges,
  groupReviewSignalsByTypeAndStatus,
} from "@/server/repositories/analytics-repository";

export interface GetReviewSignalAnalyticsParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface ReviewSignalTypeRow {
  signalType: ClauseReviewSignalType;
  totalCount: number;
  statusCounts: Record<ClauseReviewSignalStatus, number>;
  distinctContracts: number;
}

export interface StaleSignalBucketCount {
  bucket: StaleSignalBucket;
  label: string;
  count: number;
}

export interface ReviewSignalAnalytics {
  rows: ReviewSignalTypeRow[];
  totalOpen: number;
  staleBuckets: StaleSignalBucketCount[];
  asOf: string;
  scope: AnalyticsScopeMetadata;
}

function emptyStatusCounts(): Record<ClauseReviewSignalStatus, number> {
  return Object.fromEntries(Object.values(ClauseReviewSignalStatus).map((s) => [s, 0])) as Record<
    ClauseReviewSignalStatus,
    number
  >;
}

/**
 * §15/§16 - never combined into a single "risk score" (signal counts are
 * shown per type/status, not summed into one number that could read as a
 * severity ranking - see domain/clauses/labels.ts's banned phrasing list).
 * §16's stale-age buckets are explicitly a work-prioritization aid, not a
 * legal risk measure (see domain/analytics/labels.ts's STALE_SIGNAL_NOTE).
 *
 * Phase 8.1: every contract-level filter propagates via a `contract: {...}`
 * relation filter (§5/§10 - never a huge IN array), clauseType/signalStatus/
 * signalType narrow the signal query itself, and dateBasis is
 * ClauseReviewSignal.createdAt (§2).
 */
export async function getReviewSignalAnalytics(
  params: GetReviewSignalAnalyticsParams
): Promise<ReviewSignalAnalytics> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.reviewSignals;
  const period = resolveSectionPeriod(filters, section.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);
  const signalOptions = {
    contractWhere,
    clauseType: filters.clauseType,
    signalStatus: filters.signalStatus,
    signalType: filters.signalType,
    createdFrom: period.from,
    createdTo: period.to,
  };

  const [typeStatusRows, openAges] = await Promise.all([
    groupReviewSignalsByTypeAndStatus(organizationId, signalOptions),
    findOpenReviewSignalAges(organizationId, {
      contractWhere,
      clauseType: filters.clauseType,
      signalType: filters.signalType,
      createdFrom: period.from,
      createdTo: period.to,
    }),
  ]);

  const byType = new Map<ClauseReviewSignalType, Record<ClauseReviewSignalStatus, number>>();
  for (const row of typeStatusRows) {
    const counts = byType.get(row.signalType) ?? emptyStatusCounts();
    counts[row.status] = row.count;
    byType.set(row.signalType, counts);
  }

  const presentTypes = [...byType.keys()];
  const distinctContractCounts = await Promise.all(
    presentTypes.map((signalType) => distinctContractCountForSignalType(organizationId, signalType, signalOptions))
  );
  const distinctByType = new Map(presentTypes.map((type, index) => [type, distinctContractCounts[index] ?? 0]));

  const rows: ReviewSignalTypeRow[] = presentTypes
    .map((signalType) => {
      const statusCounts = byType.get(signalType) ?? emptyStatusCounts();
      const totalCount = Object.values(statusCounts).reduce((sum, c) => sum + c, 0);
      return {
        signalType,
        totalCount,
        statusCounts,
        distinctContracts: distinctByType.get(signalType) ?? 0,
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount);

  const bucketCounts = new Map<StaleSignalBucket, number>();
  for (const age of openAges) {
    const bucket = staleSignalBucketForAge(age.createdAt, now);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  return {
    rows,
    totalOpen: openAges.length,
    staleBuckets: STALE_SIGNAL_BUCKETS.map((bucket) => ({
      bucket,
      label: STALE_SIGNAL_BUCKET_LABELS[bucket],
      count: bucketCounts.get(bucket) ?? 0,
    })),
    asOf: now.toISOString(),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "signalCreatedAt",
      periodApplied: period.applied,
      now,
    }),
  };
}
