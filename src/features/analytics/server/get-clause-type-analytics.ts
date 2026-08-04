import { ClauseClassificationState, ClauseType } from "@/generated/prisma/enums";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { safePercentage } from "@/domain/analytics/labels";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  distinctContractCountByEffectiveClauseType,
  groupLatestClausesByClassificationState,
  groupLatestClausesByEffectiveType,
  latestReadySegmentationJobIdsForOrganization,
  listClauseStandardsForUsageStats,
} from "@/server/repositories/analytics-repository";

export interface GetClauseTypeAnalyticsParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface ClauseTypeAnalyticsRow {
  clauseType: ClauseType;
  clauseCount: number;
  contractCount: number;
  hasActiveStandard: boolean;
}

export interface ClauseTypeAnalytics {
  totalClauses: number;
  rows: ClauseTypeAnalyticsRow[];
  classificationStateCounts: Record<ClauseClassificationState, number>;
  /** §13/§14 - "구조화 현황", never phrased as completeness/legal safety (see domain/clauses/labels.ts). */
  correctedRatio: number;
  scope: AnalyticsScopeMetadata;
}

/**
 * §13 - scoped to the latest segmentation revision per document only
 * (latestReadySegmentationJobIdsForOrganization mirrors the same "latest
 * job per document" rule search-org-clauses.ts already uses), so a
 * re-segmented contract's superseded clauses are never double-counted -
 * this invariant holds regardless of which filters are applied (§7).
 *
 * Phase 8.1: contractType/displayStatus/counterpartyId/currency/autoRenewal
 * propagate via the job set itself (only jobs whose contract matches
 * survive latestReadySegmentationJobIdsForOrganization's contractWhere).
 * clauseType additionally narrows the type breakdown AND the
 * classification-state counts. dateBasis is the latest job's completedAt
 * (never a superseded revision's - §7/§2).
 */
export async function getClauseTypeAnalytics(
  params: GetClauseTypeAnalyticsParams
): Promise<ClauseTypeAnalytics> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.clauseType;
  const period = resolveSectionPeriod(filters, section.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const jobIds = await latestReadySegmentationJobIdsForOrganization(organizationId, {
    contractWhere,
    completedFrom: period.from,
    completedTo: period.to,
  });

  const [typeCounts, contractCounts, classificationCounts, standards] = await Promise.all([
    groupLatestClausesByEffectiveType(organizationId, jobIds),
    distinctContractCountByEffectiveClauseType(organizationId, jobIds),
    groupLatestClausesByClassificationState(organizationId, jobIds, filters.clauseType),
    listClauseStandardsForUsageStats(organizationId),
  ]);

  const activeStandardTypes = new Set(standards.filter((s) => s.isActive).map((s) => s.clauseType));
  const contractCountByType = new Map(contractCounts.map((row) => [row.clauseType, row.contractCount]));
  const clauseCountByType = new Map(typeCounts.map((row) => [row.clauseType, row.count]));

  const relevantTypes = filters.clauseType ? [filters.clauseType] : Object.values(ClauseType);
  const totalClauses = relevantTypes.reduce((sum, type) => sum + (clauseCountByType.get(type) ?? 0), 0);

  const rows: ClauseTypeAnalyticsRow[] = relevantTypes
    .map((clauseType) => ({
      clauseType,
      clauseCount: clauseCountByType.get(clauseType) ?? 0,
      contractCount: contractCountByType.get(clauseType) ?? 0,
      hasActiveStandard: activeStandardTypes.has(clauseType),
    }))
    .filter((row) => row.clauseCount > 0)
    .sort((a, b) => b.clauseCount - a.clauseCount);

  const classificationStateCounts = Object.fromEntries(
    Object.values(ClauseClassificationState).map((state) => [state, 0])
  ) as Record<ClauseClassificationState, number>;
  for (const row of classificationCounts) {
    classificationStateCounts[row.classificationState] = row.count;
  }

  const correctedCount = classificationStateCounts[ClauseClassificationState.CORRECTED];
  const reviewedCount =
    classificationStateCounts[ClauseClassificationState.CONFIRMED] +
    classificationStateCounts[ClauseClassificationState.CORRECTED] +
    classificationStateCounts[ClauseClassificationState.REJECTED];

  return {
    totalClauses,
    rows,
    classificationStateCounts,
    correctedRatio: safePercentage(correctedCount, reviewedCount),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "jobCompletedAt",
      periodApplied: period.applied,
      latestRevisionOnly: true,
      now,
    }),
  };
}
