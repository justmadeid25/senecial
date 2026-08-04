import { CLAUSE_REVIEW_SIGNAL_STATUS_LABELS, CLAUSE_REVIEW_SIGNAL_TYPE_LABELS, CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { getComputedContractStatus } from "@/domain/contracts/get-computed-contract-status";
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { buildCsvDocument } from "@/domain/analytics/csv";
import { ANALYTICS_FILTER_MATRIX, type AnalyticsSection } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { presentFilterKeys } from "@/domain/analytics/scope-metadata";
import { parseAnalyticsFilters, type AnalyticsExportType, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { ANALYTICS_CSV_MAX_ROWS, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { formatDateKst } from "@/lib/format/date";
import { getClauseTypeAnalytics } from "@/features/analytics/server/get-clause-type-analytics";
import { getCounterpartyAnalytics } from "@/features/analytics/server/get-counterparty-analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import { buildReviewSignalWhere } from "@/server/repositories/analytics-repository";
import { prisma } from "@/server/db/client";

export interface ExportAnalyticsCsvParams {
  userId: string;
  organizationId: string;
  exportType: AnalyticsExportType;
  /** Raw, unparsed query-string-shaped filters - parsed here with the EXACT same schema the screen uses (§9), never a separate CSV-only parser. */
  rawFilters: Record<string, string | undefined>;
}

export interface AnalyticsCsvResult {
  csv: string;
  filenameBase: string;
  rowCount: number;
  appliedFilterKeys: string[];
}

const EXPORT_TYPE_TO_SECTION: Record<AnalyticsExportType, AnalyticsSection> = {
  portfolio: "portfolio",
  expiration: "expiration",
  "clause-types": "clauseType",
  "review-signals": "reviewSignals",
  counterparties: "counterparties",
};

/** The exact same parser the screen's page.tsx uses (@/lib/validation/analytics's parseAnalyticsFilters) - §9 forbids a separate CSV-only filter parser. */
function parseFilters(rawFilters: Record<string, string | undefined>): AnalyticsFilterInput {
  return parseAnalyticsFilters(rawFilters);
}

/** §9's "filterKeys에는 실제 적용된 필터 이름만" - never the ignored ones, never the raw values. */
function appliedFilterKeysFor(section: AnalyticsSection, filters: AnalyticsFilterInput): string[] {
  const supported = new Set<string>(ANALYTICS_FILTER_MATRIX[section].supportedFilterKeys);
  return presentFilterKeys(filters).filter((key) => supported.has(key));
}

/**
 * §29/§31 - never includes source text (extracted document text, clause
 * text, sourceText, evidenceText) or storage keys/tokens - only the
 * id/name/date/status/amount columns explicitly listed as safe in §29. Row
 * count is always capped at ANALYTICS_CSV_MAX_ROWS. OWNER-only (§5/§29):
 * callers must have already resolved this from a DB-verified role, not a
 * session claim - enforced again here via verifyOrganizationRole.
 *
 * Phase 8.1 §9: every builder below calls the SAME buildContractAnalyticsWhere/
 * buildReviewSignalWhere/get-*-analytics service the screen uses - there is
 * no separate CSV filter implementation anywhere in this file.
 */
export async function exportAnalyticsCsv(params: ExportAnalyticsCsvParams): Promise<AnalyticsCsvResult> {
  const authContext = await verifyOrganizationRole(params.userId, params.organizationId, "OWNER");
  const organizationId = authContext.organizationId;
  const filters = parseFilters(params.rawFilters);
  const section = EXPORT_TYPE_TO_SECTION[params.exportType];
  const appliedFilterKeys = appliedFilterKeysFor(section, filters);

  let result: AnalyticsCsvResult;
  switch (params.exportType) {
    case "portfolio":
      result = await buildPortfolioCsv(organizationId, filters);
      break;
    case "expiration":
      result = await buildExpirationCsv(organizationId, filters);
      break;
    case "clause-types":
      result = await buildClauseTypeCsv({ userId: params.userId, organizationId, filters });
      break;
    case "review-signals":
      result = await buildReviewSignalsCsv(organizationId, filters);
      break;
    case "counterparties":
      result = await buildCounterpartiesCsv({ userId: params.userId, organizationId, filters });
      break;
  }
  result.appliedFilterKeys = appliedFilterKeys;

  await prisma.auditLog.create({
    data: {
      organizationId,
      userId: authContext.userId,
      entityType: "AnalyticsExport",
      entityId: params.exportType,
      action: AUDIT_ACTIONS.ANALYTICS_CSV_EXPORTED,
      metadata: { exportType: params.exportType, filterKeys: appliedFilterKeys, rowCount: result.rowCount },
    },
  });

  return result;
}

async function buildPortfolioCsv(organizationId: string, filters: AnalyticsFilterInput): Promise<AnalyticsCsvResult> {
  const now = new Date();
  const period = resolveSectionPeriod(filters, ANALYTICS_FILTER_MATRIX.portfolio.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);
  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
    createdFrom: period.from,
    createdTo: period.to,
  };
  const where = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const contracts = await prisma.contract.findMany({
    where,
    select: {
      title: true,
      contractNumber: true,
      contractType: true,
      status: true,
      endDate: true,
      startDate: true,
      currency: true,
      amount: true,
      counterparty: { select: { name: true } },
      _count: { select: { reviewSignals: { where: { status: "OPEN" } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: ANALYTICS_CSV_MAX_ROWS,
  });

  const rows = contracts.map((contract) => [
    contract.title,
    contract.contractNumber,
    CONTRACT_TYPE_LABELS[contract.contractType],
    CONTRACT_STATUS_LABELS[getComputedContractStatus({ status: contract.status, endDate: contract.endDate }, now)],
    contract.counterparty?.name ?? "",
    formatDateKst(contract.startDate),
    formatDateKst(contract.endDate),
    contract.currency ?? "",
    contract.amount?.toString() ?? "",
    String(contract._count.reviewSignals),
  ]);

  return {
    csv: buildCsvDocument(
      ["계약명", "계약번호", "계약유형", "표시상태", "상대방명", "시작일", "종료일", "통화", "금액", "열린 검토 신호 수"],
      rows
    ),
    filenameBase: "contract-portfolio",
    rowCount: rows.length,
    appliedFilterKeys: [],
  };
}

async function buildExpirationCsv(organizationId: string, filters: AnalyticsFilterInput): Promise<AnalyticsCsvResult> {
  const now = new Date();
  const period = resolveSectionPeriod(filters, ANALYTICS_FILTER_MATRIX.expiration.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);
  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
    endDateFrom: period.from,
    endDateTo: period.to,
  };
  const where = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const contracts = await prisma.contract.findMany({
    where: { AND: [where, { endDate: { not: null } }] },
    select: {
      title: true,
      contractNumber: true,
      contractType: true,
      endDate: true,
      counterparty: { select: { name: true } },
      autoRenewal: true,
    },
    orderBy: { endDate: "asc" },
    take: ANALYTICS_CSV_MAX_ROWS,
  });

  const rows = contracts.map((contract) => [
    contract.title,
    contract.contractNumber,
    CONTRACT_TYPE_LABELS[contract.contractType],
    formatDateKst(contract.endDate),
    contract.counterparty?.name ?? "",
    contract.autoRenewal ? "Y" : "N",
  ]);

  return {
    csv: buildCsvDocument(["계약명", "계약번호", "계약유형", "종료일", "상대방명", "자동갱신"], rows),
    filenameBase: "expiration-schedule",
    rowCount: rows.length,
    appliedFilterKeys: [],
  };
}

async function buildClauseTypeCsv(params: {
  userId: string;
  organizationId: string;
  filters: AnalyticsFilterInput;
}): Promise<AnalyticsCsvResult> {
  const analytics = await getClauseTypeAnalytics(params);
  const rows = analytics.rows
    .slice(0, ANALYTICS_CSV_MAX_ROWS)
    .map((row) => [
      CLAUSE_TYPE_LABELS[row.clauseType],
      String(row.clauseCount),
      String(row.contractCount),
      row.hasActiveStandard ? "Y" : "N",
    ]);

  return {
    csv: buildCsvDocument(["조항 유형", "조항 수", "포함 계약 수", "활성 기준 조항 존재"], rows),
    filenameBase: "clause-type-stats",
    rowCount: rows.length,
    appliedFilterKeys: [],
  };
}

async function buildReviewSignalsCsv(organizationId: string, filters: AnalyticsFilterInput): Promise<AnalyticsCsvResult> {
  const now = new Date();
  const period = resolveSectionPeriod(filters, ANALYTICS_FILTER_MATRIX.reviewSignals.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);
  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
  };
  const contractWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);
  const where = buildReviewSignalWhere(organizationId, {
    contractWhere,
    clauseType: filters.clauseType,
    signalStatus: filters.signalStatus,
    signalType: filters.signalType,
    createdFrom: period.from,
    createdTo: period.to,
  });

  const signals = await prisma.clauseReviewSignal.findMany({
    where,
    select: {
      signalType: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      contract: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: ANALYTICS_CSV_MAX_ROWS,
  });

  const rows = signals.map((signal) => [
    signal.contract.title,
    CLAUSE_REVIEW_SIGNAL_TYPE_LABELS[signal.signalType],
    CLAUSE_REVIEW_SIGNAL_STATUS_LABELS[signal.status],
    formatDateKst(signal.createdAt),
    formatDateKst(signal.reviewedAt),
  ]);

  return {
    csv: buildCsvDocument(["계약명", "신호 유형", "상태", "생성일", "확인/처리일"], rows),
    filenameBase: "review-signals",
    rowCount: rows.length,
    appliedFilterKeys: [],
  };
}

async function buildCounterpartiesCsv(params: {
  userId: string;
  organizationId: string;
  filters: AnalyticsFilterInput;
}): Promise<AnalyticsCsvResult> {
  const analytics = await getCounterpartyAnalytics(params);
  const rows: string[][] = [];
  for (const row of analytics.rows.slice(0, ANALYTICS_CSV_MAX_ROWS)) {
    if (row.amountsByCurrency.length === 0) {
      rows.push([
        row.counterpartyName,
        String(row.liveCount),
        String(row.inProgressCount),
        String(row.expiringWithin30Days),
        String(row.autoRenewalCount),
        String(row.openReviewSignalCount),
        "",
        "",
      ]);
      continue;
    }
    for (const amount of row.amountsByCurrency) {
      rows.push([
        row.counterpartyName,
        String(row.liveCount),
        String(row.inProgressCount),
        String(row.expiringWithin30Days),
        String(row.autoRenewalCount),
        String(row.openReviewSignalCount),
        amount.currency,
        amount.total,
      ]);
    }
  }

  return {
    csv: buildCsvDocument(
      ["상대방명", "살아있는 계약 수", "진행 중 계약 수", "30일 내 만료 수", "자동갱신 계약 수", "열린 검토 신호 수", "통화", "금액"],
      rows.slice(0, ANALYTICS_CSV_MAX_ROWS)
    ),
    filenameBase: "counterparty-contracts",
    rowCount: Math.min(rows.length, ANALYTICS_CSV_MAX_ROWS),
    appliedFilterKeys: [],
  };
}
