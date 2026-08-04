import { ClauseSegmentationJobStatus, ExtractionJobStatus } from "@/generated/prisma/enums";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { CLAUSE_SEGMENTATION_STALE_MINUTES } from "@/lib/config/clause-segmentation";
import { EXTRACTION_STALE_MINUTES } from "@/lib/config/extraction";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  countJobsCompletedSince,
  countMaxAttemptsReachedJobs,
  countStaleProcessingJobs,
  groupExtractionJobsByStatus,
  groupJobsByErrorCode,
  groupSegmentationJobsByStatus,
} from "@/server/repositories/analytics-repository";

export interface GetProcessingAnalyticsParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface PipelineStatusCounts {
  statusCounts: Record<string, number>;
  errorCodeCounts: Record<string, number>;
  staleCount: number;
  maxAttemptsReachedCount: number;
  completedLast7Days: number;
  failedLast7Days: number;
}

export interface ProcessingAnalytics {
  extraction: PipelineStatusCounts;
  segmentation: PipelineStatusCounts;
  asOf: string;
  scope: AnalyticsScopeMetadata;
}

/**
 * §20 - operational pipeline health only, never mixed with review-signal or
 * clause-comparison statistics on the same chart/table (§20's explicit
 * separation of "운영 오류" from "법률 분석 결과").
 *
 * Phase 8.1: contractType/displayStatus/counterpartyId/currency/autoRenewal
 * all propagate via a `contract: {...}` relation filter into every metric
 * EXCEPT `maxAttemptsReachedCount` - that one metric uses raw SQL (column-
 * to-column comparison Prisma's fluent API can't express) and is
 * documented as a known, narrow exception rather than silently filtered
 * (see analytics-repository.ts's countMaxAttemptsReachedJobs comment).
 * dateBasis is job.createdAt, applied only when the user explicitly sets a
 * period (periodDefault "none" - this is a current-state operational view).
 */
export async function getProcessingAnalytics(
  params: GetProcessingAnalyticsParams
): Promise<ProcessingAnalytics> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.processing;
  const period = resolveSectionPeriod(filters, section.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);
  const jobOptions = { contractWhere, createdFrom: period.from, createdTo: period.to };

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const extractionStaleBefore = new Date(now.getTime() - EXTRACTION_STALE_MINUTES * 60 * 1000);
  const segmentationStaleBefore = new Date(now.getTime() - CLAUSE_SEGMENTATION_STALE_MINUTES * 60 * 1000);

  const [
    extractionStatusRows,
    extractionErrorRows,
    extractionStale,
    extractionMaxAttempts,
    extractionCompleted7d,
    extractionFailed7d,
    segmentationStatusRows,
    segmentationErrorRows,
    segmentationStale,
    segmentationMaxAttempts,
    segmentationCompleted7d,
    segmentationFailed7d,
  ] = await Promise.all([
    groupExtractionJobsByStatus(organizationId, jobOptions),
    groupJobsByErrorCode(organizationId, "extraction", jobOptions),
    countStaleProcessingJobs(organizationId, "extraction", extractionStaleBefore, { contractWhere }),
    countMaxAttemptsReachedJobs(organizationId, "extraction"),
    countJobsCompletedSince(organizationId, "extraction", sevenDaysAgo, true, contractWhere),
    countJobsCompletedSince(organizationId, "extraction", sevenDaysAgo, false, contractWhere),
    groupSegmentationJobsByStatus(organizationId, jobOptions),
    groupJobsByErrorCode(organizationId, "segmentation", jobOptions),
    countStaleProcessingJobs(organizationId, "segmentation", segmentationStaleBefore, { contractWhere }),
    countMaxAttemptsReachedJobs(organizationId, "segmentation"),
    countJobsCompletedSince(organizationId, "segmentation", sevenDaysAgo, true, contractWhere),
    countJobsCompletedSince(organizationId, "segmentation", sevenDaysAgo, false, contractWhere),
  ]);

  function toStatusRecord<T extends string>(
    rows: Array<{ status: T; count: number }>,
    allStatuses: readonly T[]
  ): Record<string, number> {
    const record = Object.fromEntries(allStatuses.map((s) => [s, 0]));
    for (const row of rows) {
      record[row.status] = row.count;
    }
    return record;
  }

  function toErrorRecord(rows: Array<{ errorCode: string; count: number }>): Record<string, number> {
    return Object.fromEntries(rows.map((row) => [row.errorCode, row.count]));
  }

  return {
    extraction: {
      statusCounts: toStatusRecord(extractionStatusRows, Object.values(ExtractionJobStatus)),
      errorCodeCounts: toErrorRecord(extractionErrorRows),
      staleCount: extractionStale,
      maxAttemptsReachedCount: extractionMaxAttempts,
      completedLast7Days: extractionCompleted7d,
      failedLast7Days: extractionFailed7d,
    },
    segmentation: {
      statusCounts: toStatusRecord(segmentationStatusRows, Object.values(ClauseSegmentationJobStatus)),
      errorCodeCounts: toErrorRecord(segmentationErrorRows),
      staleCount: segmentationStale,
      maxAttemptsReachedCount: segmentationMaxAttempts,
      completedLast7Days: segmentationCompleted7d,
      failedLast7Days: segmentationFailed7d,
    },
    asOf: now.toISOString(),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "jobCreatedAt",
      periodApplied: period.applied,
      now,
    }),
  };
}
