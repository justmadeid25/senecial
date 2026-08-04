import { Prisma } from "@/generated/prisma/client";
import {
  ClauseClassificationState,
  ClauseReviewSignalStatus,
  ClauseReviewSignalType,
  ClauseSegmentationJobStatus,
  ClauseType,
  ContractStatus,
  ContractType,
  ExtractionJobStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";
import { findReadyClauseSegmentationJobsByOrganization } from "@/server/repositories/clause-segmentation-job-repository";

/**
 * Every function here takes organizationId as an explicit, non-overridable
 * scope (merged last into every where clause, same convention as every
 * other repository in this codebase - see contract-repository.ts). None of
 * these ever load full clause/document text into the application - only
 * ids, enums, dates, and Decimal amounts, per §24's "don't aggregate large
 * row sets in JS" rule.
 */

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export async function countLiveContracts(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contract.count({ where: { ...where, organizationId, deletedAt: null } });
}

export interface ContractTypeCount {
  contractType: ContractType;
  count: number;
}

export async function groupContractsByType(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<ContractTypeCount[]> {
  const rows = await prisma.contract.groupBy({
    by: ["contractType"],
    where: { ...where, organizationId, deletedAt: null },
    _count: { _all: true },
  });
  return rows.map((row) => ({ contractType: row.contractType, count: row._count._all }));
}

export interface CurrencySum {
  currency: string;
  total: Prisma.Decimal;
  count: number;
}

/** Never sums across currencies - always grouped, always Decimal (§7). */
export async function sumContractAmountsByCurrency(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<CurrencySum[]> {
  const rows = await prisma.contract.groupBy({
    by: ["currency"],
    where: { ...where, organizationId, deletedAt: null, amount: { not: null }, currency: { not: null } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  return rows
    .filter((row) => row.currency !== null && row._sum.amount !== null)
    .map((row) => ({ currency: row.currency as string, total: row._sum.amount as Prisma.Decimal, count: row._count._all }));
}

export interface ContractTypeCurrencySum {
  contractType: ContractType;
  currency: string;
  total: Prisma.Decimal;
}

export async function sumContractAmountsByTypeAndCurrency(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<ContractTypeCurrencySum[]> {
  const rows = await prisma.contract.groupBy({
    by: ["contractType", "currency"],
    where: { ...where, organizationId, deletedAt: null, amount: { not: null }, currency: { not: null } },
    _sum: { amount: true },
  });
  return rows
    .filter((row) => row.currency !== null && row._sum.amount !== null)
    .map((row) => ({
      contractType: row.contractType,
      currency: row.currency as string,
      total: row._sum.amount as Prisma.Decimal,
    }));
}

export interface CounterpartyCurrencySum {
  counterpartyId: string;
  currency: string;
  total: Prisma.Decimal;
}

export async function sumContractAmountsByCounterpartyAndCurrency(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<CounterpartyCurrencySum[]> {
  const rows = await prisma.contract.groupBy({
    by: ["counterpartyId", "currency"],
    where: {
      ...where,
      organizationId,
      deletedAt: null,
      amount: { not: null },
      currency: { not: null },
      counterpartyId: { not: null },
    },
    _sum: { amount: true },
  });
  return rows
    .filter((row) => row.counterpartyId !== null && row.currency !== null && row._sum.amount !== null)
    .map((row) => ({
      counterpartyId: row.counterpartyId as string,
      currency: row.currency as string,
      total: row._sum.amount as Prisma.Decimal,
    }));
}

/** §10 - one COUNT per stored ContractStatus.status value (raw stored value, not computed display status). */
export async function groupContractsByStoredStatus(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<Array<{ status: ContractStatus; count: number }>> {
  const rows = await prisma.contract.groupBy({
    by: ["status"],
    where: { ...where, organizationId, deletedAt: null },
    _count: { _all: true },
  });
  return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

/**
 * §9/§10 - count of live contracts whose computed *display* status/expiration
 * bucket depends on a KST-day-boundary date range. Each bucket is one
 * indexed COUNT translated straight to SQL (no row loading), using the same
 * [start, endExclusive) instant pairs the caller derives from
 * domain/analytics/date-buckets.ts, so results always agree with
 * getComputedContractStatus()'s day-boundary rules.
 */
export async function countContractsInDateRange(
  organizationId: string,
  range: { gte?: Date; lt?: Date } | null,
  extraWhere?: Prisma.ContractWhereInput
): Promise<number> {
  if (range === null) {
    return prisma.contract.count({
      where: { ...extraWhere, organizationId, deletedAt: null, endDate: null },
    });
  }
  return prisma.contract.count({
    where: {
      ...extraWhere,
      organizationId,
      deletedAt: null,
      endDate: { not: null, ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) },
    },
  });
}

export async function countContractsWithoutCounterparty(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contract.count({ where: { ...where, organizationId, deletedAt: null, counterpartyId: null } });
}

export async function countContractsWithoutEndDateActive(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contract.count({
    where: { ...where, organizationId, deletedAt: null, endDate: null, status: { not: ContractStatus.DRAFT } },
  });
}

// ---------------------------------------------------------------------------
// Extraction / segmentation pipeline coverage
// ---------------------------------------------------------------------------

/** Contract ids (live, org-scoped) that have at least one extraction job in a "reached review" state. */
async function contractIdsWithExtraction(organizationId: string): Promise<Set<string>> {
  const rows = await prisma.contractExtractionJob.findMany({
    where: {
      organizationId,
      status: { in: [ExtractionJobStatus.REVIEW_REQUIRED, ExtractionJobStatus.COMPLETED] },
    },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  return new Set(rows.map((row) => row.contractId));
}

async function contractIdsWithSegmentation(organizationId: string): Promise<Set<string>> {
  const rows = await prisma.clauseSegmentationJob.findMany({
    where: {
      organizationId,
      status: { in: [ClauseSegmentationJobStatus.REVIEW_REQUIRED, ClauseSegmentationJobStatus.COMPLETED] },
    },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  return new Set(rows.map((row) => row.contractId));
}

export async function countLiveContractIds(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<string[]> {
  const rows = await prisma.contract.findMany({
    where: { ...where, organizationId, deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function countContractsWithoutExtraction(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<number> {
  const [allIds, withExtraction] = await Promise.all([
    countLiveContractIds(organizationId, where),
    contractIdsWithExtraction(organizationId),
  ]);
  return allIds.filter((id) => !withExtraction.has(id)).length;
}

export async function countContractsWithoutSegmentation(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<number> {
  const [allIds, withSegmentation] = await Promise.all([
    countLiveContractIds(organizationId, where),
    contractIdsWithSegmentation(organizationId),
  ]);
  return allIds.filter((id) => !withSegmentation.has(id)).length;
}

// ---------------------------------------------------------------------------
// Review signals
// ---------------------------------------------------------------------------

/** Distinct live-contract ids (org-scoped) that have at least one OPEN review signal. `contractWhere` (from buildContractAnalyticsWhere) propagates the contract-level filter via a relation filter - never a huge IN array (§10). */
export async function contractIdsWithOpenReviewSignals(
  organizationId: string,
  contractWhere?: Prisma.ContractWhereInput
): Promise<Set<string>> {
  const rows = await prisma.clauseReviewSignal.findMany({
    where: {
      organizationId,
      status: ClauseReviewSignalStatus.OPEN,
      contract: contractWhere ?? { deletedAt: null },
    },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  return new Set(rows.map((row) => row.contractId));
}

/** Same as above, but grouped by the parent contract's contractType (§11's per-type open-signal count). Loads only ids/enums, never clause/signal text. */
export async function contractTypesWithOpenReviewSignals(
  organizationId: string,
  contractWhere?: Prisma.ContractWhereInput
): Promise<Map<ContractType, Set<string>>> {
  const rows = await prisma.clauseReviewSignal.findMany({
    where: { organizationId, status: ClauseReviewSignalStatus.OPEN, contract: contractWhere ?? { deletedAt: null } },
    select: { contractId: true, contract: { select: { contractType: true } } },
    distinct: ["contractId"],
  });
  const map = new Map<ContractType, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.contract.contractType) ?? new Set<string>();
    set.add(row.contractId);
    map.set(row.contract.contractType, set);
  }
  return map;
}

export interface SignalTypeStatusCount {
  signalType: ClauseReviewSignalType;
  status: ClauseReviewSignalStatus;
  count: number;
}

export interface ReviewSignalQueryOptions {
  contractWhere?: Prisma.ContractWhereInput;
  clauseType?: ClauseType;
  signalStatus?: ClauseReviewSignalStatus;
  signalType?: ClauseReviewSignalType;
  createdFrom?: Date;
  createdTo?: Date;
}

/**
 * Every review-signal query below always scopes to live contracts (§7) via
 * a `contract: {...}` relation filter - never a huge IN array (§10). Phase
 * 8.1 fix: this previously had NO contract.deletedAt filter at all, so a
 * soft-deleted contract's signals leaked into §15/§16 statistics.
 *
 * Exported so export-analytics-csv.ts can build the exact same WHERE the
 * screen uses (§9 - CSV and screen must never implement filtering
 * separately).
 */
export function buildReviewSignalWhere(
  organizationId: string,
  options: ReviewSignalQueryOptions
): Prisma.ClauseReviewSignalWhereInput {
  return {
    organizationId,
    contract: options.contractWhere ?? { deletedAt: null },
    ...(options.clauseType ? { clauseType: options.clauseType } : {}),
    ...(options.signalStatus ? { status: options.signalStatus } : {}),
    ...(options.signalType ? { signalType: options.signalType } : {}),
    ...(options.createdFrom || options.createdTo
      ? {
          createdAt: {
            ...(options.createdFrom ? { gte: options.createdFrom } : {}),
            ...(options.createdTo ? { lt: options.createdTo } : {}),
          },
        }
      : {}),
  };
}

export async function groupReviewSignalsByTypeAndStatus(
  organizationId: string,
  options: ReviewSignalQueryOptions = {}
): Promise<SignalTypeStatusCount[]> {
  const rows = await prisma.clauseReviewSignal.groupBy({
    by: ["signalType", "status"],
    where: buildReviewSignalWhere(organizationId, options),
    _count: { _all: true },
  });
  return rows.map((row) => ({ signalType: row.signalType, status: row.status, count: row._count._all }));
}

export async function distinctContractCountForSignalType(
  organizationId: string,
  signalType: ClauseReviewSignalType,
  options: Omit<ReviewSignalQueryOptions, "signalType"> = {}
): Promise<number> {
  const rows = await prisma.clauseReviewSignal.findMany({
    where: buildReviewSignalWhere(organizationId, { ...options, signalType }),
    select: { contractId: true },
    distinct: ["contractId"],
  });
  return rows.length;
}

/** Age (in DB, not text) of every currently-OPEN signal - used to bucket §16's "미처리 기간" distribution. */
export async function findOpenReviewSignalAges(
  organizationId: string,
  options: Omit<ReviewSignalQueryOptions, "signalStatus"> = {}
): Promise<Array<{ createdAt: Date }>> {
  return prisma.clauseReviewSignal.findMany({
    where: buildReviewSignalWhere(organizationId, { ...options, signalStatus: ClauseReviewSignalStatus.OPEN }),
    select: { createdAt: true },
  });
}

// ---------------------------------------------------------------------------
// Clause type / classification distribution (latest segmentation revision only)
// ---------------------------------------------------------------------------

export interface LatestSegmentationJobFilterOptions {
  /** From buildContractAnalyticsWhere() - restricts which contracts' documents are eligible at all (§5/§6). */
  contractWhere?: Prisma.ContractWhereInput;
  /**
   * §2's dateBasis for the 조항 유형 분포 section is the LATEST job's
   * completedAt - never a superseded revision's. A contract whose latest
   * revision falls outside this range is dropped entirely rather than
   * falling back to an older revision, so "latest revision only" (§7) is
   * never violated by period filtering.
   */
  completedFrom?: Date;
  completedTo?: Date;
}

/**
 * §13 - "latest job per document" set, org-wide (further narrowed by
 * `options.contractWhere` when given). Mirrors the private helper already
 * duplicated in search-org-clauses.ts / search-contract-clauses.ts; kept as
 * its own small copy here (rather than a shared cross-feature import) since
 * each caller's freshness/status requirements are subtly different call
 * sites, matching this codebase's existing pattern of small per-feature
 * copies over a premature shared abstraction.
 */
export async function latestReadySegmentationJobIdsForOrganization(
  organizationId: string,
  options: LatestSegmentationJobFilterOptions = {}
): Promise<string[]> {
  const jobs = await findReadyClauseSegmentationJobsByOrganization(organizationId);
  if (jobs.length === 0) {
    return [];
  }

  // A soft-deleted (or filtered-out) contract's clauses must never appear in
  // analytics (§13/§41/§7) - findReadyClauseSegmentationJobsByOrganization()
  // only filters by job status, not by contract.deletedAt or any other
  // contract-level filter, so that exclusion happens here.
  const liveContractIds = new Set(
    (
      await prisma.contract.findMany({
        where: {
          ...(options.contractWhere ?? { organizationId, deletedAt: null }),
          id: { in: [...new Set(jobs.map((job) => job.contractId))] },
        },
        select: { id: true },
      })
    ).map((row) => row.id)
  );

  const latestByDocument = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (!liveContractIds.has(job.contractId)) {
      continue;
    }
    if (!latestByDocument.has(job.extractedDocumentId)) {
      latestByDocument.set(job.extractedDocumentId, job);
    }
  }

  const latestJobs = [...latestByDocument.values()];
  const inRange = latestJobs.filter((job) => {
    if (!job.completedAt) {
      return false;
    }
    if (options.completedFrom && job.completedAt < options.completedFrom) {
      return false;
    }
    if (options.completedTo && job.completedAt >= options.completedTo) {
      return false;
    }
    return true;
  });
  const filtered = options.completedFrom || options.completedTo ? inRange : latestJobs;
  return filtered.map((job) => job.id);
}

export interface ClauseTypeCount {
  clauseType: ClauseType;
  count: number;
}

/** Effective type = reviewedClauseType if reviewed, else suggestedClauseType - split into two grouped COUNTs (no COALESCE needed) so both stay simple SQL-side GROUP BYs. */
export async function groupLatestClausesByEffectiveType(
  organizationId: string,
  jobIds: string[]
): Promise<ClauseTypeCount[]> {
  if (jobIds.length === 0) {
    return [];
  }
  const [reviewed, suggestedOnly] = await Promise.all([
    prisma.contractClause.groupBy({
      by: ["reviewedClauseType"],
      where: { organizationId, segmentationJobId: { in: jobIds }, reviewedClauseType: { not: null } },
      _count: { _all: true },
    }),
    prisma.contractClause.groupBy({
      by: ["suggestedClauseType"],
      where: {
        organizationId,
        segmentationJobId: { in: jobIds },
        reviewedClauseType: null,
        suggestedClauseType: { not: null },
      },
      _count: { _all: true },
    }),
  ]);

  const totals = new Map<ClauseType, number>();
  for (const row of reviewed) {
    if (row.reviewedClauseType) {
      totals.set(row.reviewedClauseType, (totals.get(row.reviewedClauseType) ?? 0) + row._count._all);
    }
  }
  for (const row of suggestedOnly) {
    if (row.suggestedClauseType) {
      totals.set(row.suggestedClauseType, (totals.get(row.suggestedClauseType) ?? 0) + row._count._all);
    }
  }
  return [...totals.entries()].map(([clauseType, count]) => ({ clauseType, count }));
}

/** DISTINCT contract count per effective clause type - genuinely needs COUNT(DISTINCT), which Prisma's groupBy API cannot express, hence the one raw query in this file. jobIds is bound as a parameterized array, never string-interpolated. */
export async function distinctContractCountByEffectiveClauseType(
  organizationId: string,
  jobIds: string[]
): Promise<Array<{ clauseType: ClauseType; contractCount: number }>> {
  if (jobIds.length === 0) {
    return [];
  }
  const rows = await prisma.$queryRaw<Array<{ clausetype: ClauseType; contractcount: bigint }>>(
    Prisma.sql`
      SELECT COALESCE("reviewedClauseType", "suggestedClauseType") AS clausetype,
             COUNT(DISTINCT "contractId") AS contractcount
      FROM "contract_clauses"
      WHERE "organizationId" = ${organizationId}
        AND "segmentationJobId" = ANY(${jobIds}::text[])
        AND COALESCE("reviewedClauseType", "suggestedClauseType") IS NOT NULL
      GROUP BY 1
    `
  );
  return rows.map((row) => ({ clauseType: row.clausetype, contractCount: Number(row.contractcount) }));
}

export interface ClassificationStateCount {
  classificationState: ClauseClassificationState;
  count: number;
}

/** `clauseTypeFilter`, when given, restricts the breakdown to clauses whose EFFECTIVE type (reviewed ?? suggested) matches - so a user-selected 조항 유형 filter narrows classification-state counts too, not just the type breakdown. */
export async function groupLatestClausesByClassificationState(
  organizationId: string,
  jobIds: string[],
  clauseTypeFilter?: ClauseType
): Promise<ClassificationStateCount[]> {
  if (jobIds.length === 0) {
    return [];
  }
  const rows = await prisma.contractClause.groupBy({
    by: ["classificationState"],
    where: {
      organizationId,
      segmentationJobId: { in: jobIds },
      ...(clauseTypeFilter
        ? {
            OR: [
              { reviewedClauseType: clauseTypeFilter },
              { AND: [{ reviewedClauseType: null }, { suggestedClauseType: clauseTypeFilter }] },
            ],
          }
        : {}),
    },
    _count: { _all: true },
  });
  return rows.map((row) => ({ classificationState: row.classificationState, count: row._count._all }));
}

export async function countLatestClauses(organizationId: string, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) {
    return 0;
  }
  return prisma.contractClause.count({ where: { organizationId, segmentationJobId: { in: jobIds } } });
}

// ---------------------------------------------------------------------------
// Clause standards usage (§17)
// ---------------------------------------------------------------------------

export interface ClauseStandardUsageRow {
  id: string;
  name: string;
  clauseType: ClauseType;
  isActive: boolean;
  updatedAt: Date;
}

export async function listClauseStandardsForUsageStats(
  organizationId: string
): Promise<ClauseStandardUsageRow[]> {
  return prisma.clauseStandard.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true, clauseType: true, isActive: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

/** §17 - counts CLAUSE_COMPARISON_VIEWED AuditLog rows per standardId (metadata.standardId), never the compared text. */
export async function countComparisonViewsByStandard(
  organizationId: string
): Promise<Map<string, number>> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, action: "CLAUSE_COMPARISON_VIEWED" },
    select: { metadata: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const metadata = row.metadata as { standardId?: string } | null;
    const standardId = metadata?.standardId;
    if (standardId) {
      counts.set(standardId, (counts.get(standardId) ?? 0) + 1);
    }
  }
  return counts;
}

export async function countReviewSignalsByStandard(organizationId: string): Promise<Map<string, number>> {
  const rows = await prisma.clauseReviewSignal.groupBy({
    by: ["clauseStandardId"],
    where: { organizationId, clauseStandardId: { not: null } },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.clauseStandardId) {
      counts.set(row.clauseStandardId, row._count._all);
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Counterparties (§19)
// ---------------------------------------------------------------------------

export interface CounterpartySummaryRow {
  id: string;
  name: string;
}

export async function listLiveCounterparties(organizationId: string): Promise<CounterpartySummaryRow[]> {
  return prisma.counterparty.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export interface CounterpartyContractAggregate {
  counterpartyId: string;
  liveCount: number;
  autoRenewalCount: number;
  lastUpdatedAt: Date | null;
}

export async function groupContractsByCounterparty(
  organizationId: string,
  where?: Prisma.ContractWhereInput
): Promise<CounterpartyContractAggregate[]> {
  const rows = await prisma.contract.groupBy({
    by: ["counterpartyId"],
    where: { ...where, organizationId, deletedAt: null, counterpartyId: { not: null } },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const autoRenewalRows = await prisma.contract.groupBy({
    by: ["counterpartyId"],
    where: { ...where, organizationId, deletedAt: null, counterpartyId: { not: null }, autoRenewal: true },
    _count: { _all: true },
  });
  const autoRenewalByCounterparty = new Map(
    autoRenewalRows.map((row) => [row.counterpartyId as string, row._count._all])
  );
  return rows
    .filter((row) => row.counterpartyId !== null)
    .map((row) => ({
      counterpartyId: row.counterpartyId as string,
      liveCount: row._count._all,
      autoRenewalCount: autoRenewalByCounterparty.get(row.counterpartyId as string) ?? 0,
      lastUpdatedAt: row._max.updatedAt,
    }));
}

// ---------------------------------------------------------------------------
// Processing pipeline (§20)
// ---------------------------------------------------------------------------

export interface ProcessingJobFilterOptions {
  /** From buildContractAnalyticsWhere() - propagated via a `contract: {...}` relation filter, never a huge IN array (§10). */
  contractWhere?: Prisma.ContractWhereInput;
  /** §2's dateBasis for 처리 파이프라인 is job.createdAt - only applied when the caller explicitly sets one (periodDefault: "none", see filter-matrix.ts). */
  createdFrom?: Date;
  createdTo?: Date;
}

function buildJobCreatedAtWhere(options: ProcessingJobFilterOptions): Prisma.DateTimeFilter | undefined {
  if (!options.createdFrom && !options.createdTo) {
    return undefined;
  }
  return {
    ...(options.createdFrom ? { gte: options.createdFrom } : {}),
    ...(options.createdTo ? { lt: options.createdTo } : {}),
  };
}

export async function groupExtractionJobsByStatus(
  organizationId: string,
  options: ProcessingJobFilterOptions = {}
): Promise<Array<{ status: ExtractionJobStatus; count: number }>> {
  const createdAt = buildJobCreatedAtWhere(options);
  const rows = await prisma.contractExtractionJob.groupBy({
    by: ["status"],
    where: {
      organizationId,
      ...(options.contractWhere ? { contract: options.contractWhere } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    _count: { _all: true },
  });
  return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

export async function groupSegmentationJobsByStatus(
  organizationId: string,
  options: ProcessingJobFilterOptions = {}
): Promise<Array<{ status: ClauseSegmentationJobStatus; count: number }>> {
  const createdAt = buildJobCreatedAtWhere(options);
  const rows = await prisma.clauseSegmentationJob.groupBy({
    by: ["status"],
    where: {
      organizationId,
      ...(options.contractWhere ? { contract: options.contractWhere } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    _count: { _all: true },
  });
  return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

export async function groupJobsByErrorCode(
  organizationId: string,
  kind: "extraction" | "segmentation",
  options: ProcessingJobFilterOptions = {}
): Promise<Array<{ errorCode: string; count: number }>> {
  const createdAt = buildJobCreatedAtWhere(options);
  if (kind === "extraction") {
    const rows = await prisma.contractExtractionJob.groupBy({
      by: ["errorCode"],
      where: {
        organizationId,
        errorCode: { not: null },
        ...(options.contractWhere ? { contract: options.contractWhere } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      _count: { _all: true },
    });
    return rows.filter((row) => row.errorCode).map((row) => ({ errorCode: row.errorCode as string, count: row._count._all }));
  }
  const rows = await prisma.clauseSegmentationJob.groupBy({
    by: ["errorCode"],
    where: {
      organizationId,
      errorCode: { not: null },
      ...(options.contractWhere ? { contract: options.contractWhere } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    _count: { _all: true },
  });
  return rows.filter((row) => row.errorCode).map((row) => ({ errorCode: row.errorCode as string, count: row._count._all }));
}

export async function countStaleProcessingJobs(
  organizationId: string,
  kind: "extraction" | "segmentation",
  staleBefore: Date,
  options: ProcessingJobFilterOptions = {}
): Promise<number> {
  if (kind === "extraction") {
    return prisma.contractExtractionJob.count({
      where: {
        organizationId,
        status: ExtractionJobStatus.PROCESSING,
        lockedAt: { lte: staleBefore },
        ...(options.contractWhere ? { contract: options.contractWhere } : {}),
      },
    });
  }
  return prisma.clauseSegmentationJob.count({
    where: {
      organizationId,
      status: ClauseSegmentationJobStatus.PROCESSING,
      lockedAt: { lte: staleBefore },
      ...(options.contractWhere ? { contract: options.contractWhere } : {}),
    },
  });
}

/**
 * Prisma's fluent API can't compare two columns of the same row (attempt >=
 * maxAttempts), so this one count uses raw SQL - table name is a fixed
 * literal, never user input. Phase 8.1 scope note: unlike the other
 * processing-pipeline queries above, this one does NOT accept a contract
 * filter - retrofitting the contract-level filter into this specific raw
 * query would require a correlated subquery per filter combination, which
 * isn't worth the risk for this one niche metric (최대 재시도 도달 건수).
 * Documented as a known limitation in the README/final report rather than
 * silently applied.
 */
export async function countMaxAttemptsReachedJobs(
  organizationId: string,
  kind: "extraction" | "segmentation"
): Promise<number> {
  const table = kind === "extraction" ? "contract_extraction_jobs" : "clause_segmentation_jobs";
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*) AS count FROM ${Prisma.raw(`"${table}"`)}
      WHERE "organizationId" = ${organizationId} AND "status" = 'FAILED' AND "attempt" >= "maxAttempts"
    `
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countJobsCompletedSince(
  organizationId: string,
  kind: "extraction" | "segmentation",
  since: Date,
  success: boolean,
  contractWhere?: Prisma.ContractWhereInput
): Promise<number> {
  if (kind === "extraction") {
    return prisma.contractExtractionJob.count({
      where: success
        ? { organizationId, completedAt: { gte: since }, ...(contractWhere ? { contract: contractWhere } : {}) }
        : { organizationId, failedAt: { gte: since }, ...(contractWhere ? { contract: contractWhere } : {}) },
    });
  }
  return prisma.clauseSegmentationJob.count({
    where: success
      ? { organizationId, completedAt: { gte: since }, ...(contractWhere ? { contract: contractWhere } : {}) }
      : { organizationId, failedAt: { gte: since }, ...(contractWhere ? { contract: contractWhere } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Monthly trends (§22) - one indexed COUNT per (metric, month) bucket, run
// in parallel. At this Phase's data scale (real-time chosen, see README)
// this stays well under the 1s/query development target; see the
// performance benchmark script for measured numbers at larger scale.
// ---------------------------------------------------------------------------

/** §6 monthly trends - contractWhere propagates the same contract-level filter (via relation filter for the job-based metrics) into every monthly bucket count; the month's own [start, endExclusive) range is a SEPARATE, always-applied condition (never overridden by the filter). */
export async function countContractsCreatedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  contractWhere?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contract.count({
    where: { ...contractWhere, organizationId, createdAt: { gte: start, lt: endExclusive } },
  });
}

export async function countContractsExpiredInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  contractWhere?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contract.count({
    where: { ...contractWhere, organizationId, deletedAt: null, endDate: { gte: start, lt: endExclusive } },
  });
}

export async function countReviewSignalsCreatedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  options: Omit<ReviewSignalQueryOptions, "createdFrom" | "createdTo"> = {}
): Promise<number> {
  return prisma.clauseReviewSignal.count({
    where: buildReviewSignalWhere(organizationId, { ...options, createdFrom: start, createdTo: endExclusive }),
  });
}

export async function countReviewSignalsResolvedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  options: Pick<ReviewSignalQueryOptions, "contractWhere" | "clauseType" | "signalType"> = {}
): Promise<number> {
  return prisma.clauseReviewSignal.count({
    where: {
      ...buildReviewSignalWhere(organizationId, { ...options, signalStatus: ClauseReviewSignalStatus.RESOLVED }),
      reviewedAt: { gte: start, lt: endExclusive },
    },
  });
}

export async function countExtractionsCompletedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  contractWhere?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.contractExtractionJob.count({
    where: {
      organizationId,
      status: ExtractionJobStatus.COMPLETED,
      completedAt: { gte: start, lt: endExclusive },
      ...(contractWhere ? { contract: contractWhere } : {}),
    },
  });
}

export async function countSegmentationsCompletedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  contractWhere?: Prisma.ContractWhereInput
): Promise<number> {
  return prisma.clauseSegmentationJob.count({
    where: {
      organizationId,
      status: ClauseSegmentationJobStatus.COMPLETED,
      completedAt: { gte: start, lt: endExclusive },
      ...(contractWhere ? { contract: contractWhere } : {}),
    },
  });
}

export async function countClauseStandardsCreatedInRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  clauseType?: ClauseType
): Promise<number> {
  return prisma.clauseStandard.count({
    where: {
      organizationId,
      deletedAt: null,
      createdAt: { gte: start, lt: endExclusive },
      ...(clauseType ? { clauseType } : {}),
    },
  });
}
