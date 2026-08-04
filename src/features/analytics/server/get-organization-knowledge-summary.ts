import { ClauseType } from "@/generated/prisma/enums";
import { compareClauseToStandard } from "@/domain/clauses/clause-diff";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  countComparisonViewsByStandard,
  countReviewSignalsByStandard,
  groupLatestClausesByEffectiveType,
  latestReadySegmentationJobIdsForOrganization,
  listClauseStandardsForUsageStats,
  type ClauseStandardUsageRow,
} from "@/server/repositories/analytics-repository";
import { prisma } from "@/server/db/client";

export interface GetOrganizationKnowledgeSummaryParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface StandardUsageRow {
  id: string;
  name: string;
  clauseType: ClauseType;
  clauseTypeLabel: string;
  isActive: boolean;
  comparisonViewCount: number;
  relatedReviewSignalCount: number;
  updatedAt: string;
}

export interface RecurringDifferenceRow {
  clauseType: ClauseType;
  clauseTypeLabel: string;
  standardName: string;
  comparedClauseCount: number;
  numberDifferenceCount: number;
  dateDifferenceCount: number;
  amountDifferenceCount: number;
  textDifferenceCount: number;
}

export interface OrganizationKnowledgeSummary {
  mostFrequentClauseTypes: Array<{ clauseType: ClauseType; label: string; count: number }>;
  clauseTypesWithStandard: Array<{ clauseType: ClauseType; label: string }>;
  frequentClauseTypesMissingStandard: Array<{ clauseType: ClauseType; label: string; count: number }>;
  standardUsage: StandardUsageRow[];
  recentStandards: StandardUsageRow[];
  recurringDifferences: RecurringDifferenceRow[];
  scope: AnalyticsScopeMetadata;
}

/** Caps the cost of §18's on-demand comparison strategy (Strategy A) - see README's design-decision note. */
const MAX_CLAUSES_COMPARED_PER_STANDARD = 20;
const MIN_CLAUSE_COUNT_TO_FLAG_MISSING_STANDARD = 2;

function toUsageRow(
  standard: ClauseStandardUsageRow,
  viewCounts: Map<string, number>,
  signalCounts: Map<string, number>
): StandardUsageRow {
  return {
    id: standard.id,
    name: standard.name,
    clauseType: standard.clauseType,
    clauseTypeLabel: CLAUSE_TYPE_LABELS[standard.clauseType],
    isActive: standard.isActive,
    comparisonViewCount: viewCounts.get(standard.id) ?? 0,
    relatedReviewSignalCount: signalCounts.get(standard.id) ?? 0,
    updatedAt: standard.updatedAt.toISOString(),
  };
}

/**
 * §17/§18/§21 - purely descriptive, fact-based statements ("최근 계약에서
 * 비밀유지 조항이 18건 확인되었습니다") - never a management-quality or risk
 * judgement (§21's explicit banned-phrasing examples). §18's recurring
 * differences use Strategy A (bounded on-demand comparison, capped at
 * MAX_CLAUSES_COMPARED_PER_STANDARD per standard) rather than a persisted
 * snapshot - see README for the measured cost at current data scale.
 *
 * Phase 8.1: contractType/displayStatus/counterpartyId/currency/autoRenewal
 * propagate via the underlying segmentation job set (same mechanism as
 * get-clause-type-analytics.ts). clauseType additionally narrows every
 * list here to that one type. No period filter (§6's matrix - this is an
 * always-current summary).
 */
export async function getOrganizationKnowledgeSummary(
  params: GetOrganizationKnowledgeSummaryParams
): Promise<OrganizationKnowledgeSummary> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;
  const section = ANALYTICS_FILTER_MATRIX.knowledge;

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const jobIds = await latestReadySegmentationJobIdsForOrganization(organizationId, { contractWhere });

  const [typeCountsRaw, standardsRaw, viewCounts, signalCounts] = await Promise.all([
    groupLatestClausesByEffectiveType(organizationId, jobIds),
    listClauseStandardsForUsageStats(organizationId),
    countComparisonViewsByStandard(organizationId),
    countReviewSignalsByStandard(organizationId),
  ]);

  const typeCounts = filters.clauseType
    ? typeCountsRaw.filter((row) => row.clauseType === filters.clauseType)
    : typeCountsRaw;
  const standards = filters.clauseType
    ? standardsRaw.filter((row) => row.clauseType === filters.clauseType)
    : standardsRaw;

  const sortedTypeCounts = [...typeCounts].sort((a, b) => b.count - a.count);
  const mostFrequentClauseTypes = sortedTypeCounts
    .slice(0, 10)
    .map((row) => ({ clauseType: row.clauseType, label: CLAUSE_TYPE_LABELS[row.clauseType], count: row.count }));

  const activeStandardTypes = new Set(standards.filter((s) => s.isActive).map((s) => s.clauseType));
  const clauseTypesWithStandard = [...activeStandardTypes].map((clauseType) => ({
    clauseType,
    label: CLAUSE_TYPE_LABELS[clauseType],
  }));

  const frequentClauseTypesMissingStandard = sortedTypeCounts
    .filter(
      (row) => !activeStandardTypes.has(row.clauseType) && row.count >= MIN_CLAUSE_COUNT_TO_FLAG_MISSING_STANDARD
    )
    .slice(0, 10)
    .map((row) => ({ clauseType: row.clauseType, label: CLAUSE_TYPE_LABELS[row.clauseType], count: row.count }));

  const standardUsage = standards.map((standard) => toUsageRow(standard, viewCounts, signalCounts));
  const recentStandards = [...standards]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5)
    .map((standard) => toUsageRow(standard, viewCounts, signalCounts));

  const scope = buildScopeMetadata({
    presentFilterKeys: presentFilterKeys(filters),
    supportedFilterKeys: section.supportedFilterKeys,
    dateBasis: undefined,
    periodApplied: false,
    latestRevisionOnly: true,
    now,
  });

  const activeStandards = standards.filter((s) => s.isActive);
  const recurringDifferences: RecurringDifferenceRow[] = [];
  if (jobIds.length === 0) {
    return {
      mostFrequentClauseTypes,
      clauseTypesWithStandard,
      frequentClauseTypesMissingStandard,
      standardUsage,
      recentStandards,
      recurringDifferences,
      scope,
    };
  }
  for (const standard of activeStandards) {
    const clauses = await prisma.contractClause.findMany({
      where: {
        organizationId,
        segmentationJobId: { in: jobIds },
        OR: [{ reviewedClauseType: standard.clauseType }, { suggestedClauseType: standard.clauseType }],
      },
      select: { text: true },
      take: MAX_CLAUSES_COMPARED_PER_STANDARD,
    });
    if (clauses.length === 0) {
      continue;
    }

    const standardText = await prisma.clauseStandard.findUnique({
      where: { id: standard.id },
      select: { text: true },
    });
    if (!standardText) {
      continue;
    }

    let numberDiffCount = 0;
    let dateDiffCount = 0;
    let amountDiffCount = 0;
    let textDiffCount = 0;
    for (const clause of clauses) {
      const comparison = compareClauseToStandard(clause.text, standardText.text);
      if (comparison.numberDifference.onlyInStandard.length + comparison.numberDifference.onlyInClause.length > 0) {
        numberDiffCount += 1;
      }
      if (comparison.dateDifference.onlyInStandard.length + comparison.dateDifference.onlyInClause.length > 0) {
        dateDiffCount += 1;
      }
      if (
        comparison.amountDifference.onlyInStandard.length + comparison.amountDifference.onlyInClause.length >
        0
      ) {
        amountDiffCount += 1;
      }
      if (!comparison.identical) {
        textDiffCount += 1;
      }
    }

    recurringDifferences.push({
      clauseType: standard.clauseType,
      clauseTypeLabel: CLAUSE_TYPE_LABELS[standard.clauseType],
      standardName: standard.name,
      comparedClauseCount: clauses.length,
      numberDifferenceCount: numberDiffCount,
      dateDifferenceCount: dateDiffCount,
      amountDifferenceCount: amountDiffCount,
      textDifferenceCount: textDiffCount,
    });
  }

  return {
    mostFrequentClauseTypes,
    clauseTypesWithStandard,
    frequentClauseTypesMissingStandard,
    standardUsage,
    recentStandards,
    recurringDifferences,
    scope,
  };
}
