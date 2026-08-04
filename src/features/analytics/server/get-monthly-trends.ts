import { lastNMonthsKst, monthRangeUtcBounds } from "@/domain/analytics/date-buckets";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  countClauseStandardsCreatedInRange,
  countContractsCreatedInRange,
  countContractsExpiredInRange,
  countExtractionsCompletedInRange,
  countReviewSignalsCreatedInRange,
  countReviewSignalsResolvedInRange,
  countSegmentationsCompletedInRange,
} from "@/server/repositories/analytics-repository";

export interface GetMonthlyTrendsParams {
  userId: string;
  organizationId: string;
  months?: number;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface MonthlyTrendPoint {
  month: string;
  contractsCreated: number;
  contractsExpired: number;
  reviewSignalsCreated: number;
  reviewSignalsResolved: number;
  extractionsCompleted: number;
  segmentationsCompleted: number;
  clauseStandardsCreated: number;
}

export interface MonthlyTrends {
  points: MonthlyTrendPoint[];
  scope: AnalyticsScopeMetadata;
}

/**
 * §22 - always zero-filled (a month with no activity is an explicit 0, not
 * an omitted point) and always KST calendar-month aligned via
 * lastNMonthsKst()/monthRangeUtcBounds().
 *
 * Phase 8.1: periodStart/periodEnd never resize this section's window - it
 * is always the last `months` KST months (periodDefault "fixedWindow", see
 * filter-matrix.ts). Every OTHER filter (contractType/displayStatus/
 * counterpartyId/currency/autoRenewal/clauseType/signalStatus/signalType)
 * narrows each month's own counts.
 */
export async function getMonthlyTrends(params: GetMonthlyTrendsParams): Promise<MonthlyTrends> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const months = params.months ?? ANALYTICS_DEFAULT_MONTHS;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;
  const monthKeys = lastNMonthsKst(months, now);

  const section = ANALYTICS_FILTER_MATRIX.monthlyTrends;
  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);
  const signalOptions = { contractWhere, clauseType: filters.clauseType, signalType: filters.signalType };

  const points = await Promise.all(
    monthKeys.map(async (month) => {
      const { start, endExclusive } = monthRangeUtcBounds(month);
      const [
        contractsCreated,
        contractsExpired,
        reviewSignalsCreated,
        reviewSignalsResolved,
        extractionsCompleted,
        segmentationsCompleted,
        clauseStandardsCreated,
      ] = await Promise.all([
        countContractsCreatedInRange(organizationId, start, endExclusive, contractWhere),
        countContractsExpiredInRange(organizationId, start, endExclusive, contractWhere),
        countReviewSignalsCreatedInRange(organizationId, start, endExclusive, {
          ...signalOptions,
          signalStatus: filters.signalStatus,
        }),
        // Already implicitly status: RESOLVED - an additional signalStatus
        // filter from the user only makes sense if it's also RESOLVED, so
        // it is intentionally not passed here (see get-monthly-trends.ts's
        // module comment / README's filter matrix note).
        countReviewSignalsResolvedInRange(organizationId, start, endExclusive, signalOptions),
        countExtractionsCompletedInRange(organizationId, start, endExclusive, contractWhere),
        countSegmentationsCompletedInRange(organizationId, start, endExclusive, contractWhere),
        countClauseStandardsCreatedInRange(organizationId, start, endExclusive, filters.clauseType),
      ]);
      return {
        month,
        contractsCreated,
        contractsExpired,
        reviewSignalsCreated,
        reviewSignalsResolved,
        extractionsCompleted,
        segmentationsCompleted,
        clauseStandardsCreated,
      };
    })
  );

  return {
    points,
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "fixedWindow",
      periodApplied: false,
      now,
    }),
  };
}
