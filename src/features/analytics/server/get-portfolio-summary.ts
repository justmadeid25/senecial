import { Prisma } from "@/generated/prisma/client";
import { ContractStatus } from "@/generated/prisma/enums";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  contractIdsWithOpenReviewSignals,
  countContractsWithoutCounterparty,
  countContractsWithoutEndDateActive,
  countContractsWithoutExtraction,
  countContractsWithoutSegmentation,
  countLiveContracts,
  groupContractsByStoredStatus,
  sumContractAmountsByCurrency,
  type CurrencySum,
} from "@/server/repositories/analytics-repository";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

export interface GetPortfolioSummaryParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface CurrencyAmountView {
  currency: string;
  total: string;
  count: number;
}

export interface PortfolioSummary {
  totalLive: number;
  inProgress: number;
  expiringWithin30Days: number;
  alreadyExpired: number;
  autoRenewalCount: number;
  contractsWithOpenSignals: number;
  contractsWithoutCounterparty: number;
  contractsMissingExtraction: number;
  contractsMissingSegmentation: number;
  contractsWithoutEndDateActive: number;
  storedStatusCounts: Record<ContractStatus, number>;
  displayStatusCounts: Record<ContractStatus, number>;
  activeAmountsByCurrency: CurrencyAmountView[];
  expiringSoonAmountsByCurrency: CurrencyAmountView[];
  autoRenewalAmountsByCurrency: CurrencyAmountView[];
  contractsWithoutAmount: number;
  asOf: string;
  scope: AnalyticsScopeMetadata;
}

function toCurrencyView(rows: CurrencySum[]): CurrencyAmountView[] {
  return rows.map((row) => ({ currency: row.currency, total: row.total.toString(), count: row.count }));
}

/** Combines an already-built where with ONE additional specific display status - lets a card ask "of the contracts already matching the user's filters, how many are also EXPIRING" even when the user's own filter already constrains displayStatus to something else (naturally yields 0 rather than silently ignoring the conflict). */
function withDisplayStatus(
  base: Prisma.ContractWhereInput,
  status: ContractStatus,
  now: Date
): Prisma.ContractWhereInput {
  return { AND: [base, buildDisplayStatusWhere(status, now)] };
}

/**
 * §8/§10/§12 - every status/expiration figure is computed via
 * buildDisplayStatusWhere(), the same SQL translation of
 * getComputedContractStatus()'s KST day-boundary rules used by the plain
 * contract list/dashboard, so these numbers never disagree.
 *
 * Phase 8.1: contractType/displayStatus/counterpartyId/currency/autoRenewal
 * all narrow this summary now (§6's matrix - "포트폴리오 현재 요약" row).
 * The period filter is the one exception: it only applies when the user
 * explicitly sets it (periodDefault "none") - see filter-matrix.ts.
 */
export async function getPortfolioSummary(params: GetPortfolioSummaryParams): Promise<PortfolioSummary> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const allStatuses = Object.values(ContractStatus);
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.portfolio;
  const period = resolveSectionPeriod(filters, section.periodDefault, now, ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS);

  const contractFilter: ContractAnalyticsFilter = {
    contractType: filters.contractType,
    displayStatus: filters.displayStatus,
    counterpartyId: filters.counterpartyId,
    currency: filters.currency,
    autoRenewal: filters.autoRenewal,
    createdFrom: period.from,
    createdTo: period.to,
  };
  const baseWhere = buildContractAnalyticsWhere(organizationId, contractFilter, now);

  const [
    totalLive,
    inProgress,
    expiringWithin30Days,
    alreadyExpired,
    autoRenewalCount,
    openSignalContractIds,
    contractsWithoutCounterparty,
    contractsMissingExtraction,
    contractsMissingSegmentation,
    contractsWithoutEndDateActive,
    storedStatusRows,
    activeAmounts,
    expiringSoonAmounts,
    autoRenewalAmounts,
    contractsWithoutAmount,
    displayStatusEntries,
  ] = await Promise.all([
    countLiveContracts(organizationId, baseWhere),
    countLiveContracts(organizationId, withDisplayStatus(baseWhere, ContractStatus.ACTIVE, now)),
    countLiveContracts(organizationId, withDisplayStatus(baseWhere, ContractStatus.EXPIRING, now)),
    countLiveContracts(organizationId, withDisplayStatus(baseWhere, ContractStatus.EXPIRED, now)),
    countLiveContracts(organizationId, { AND: [baseWhere, { autoRenewal: true }] }),
    contractIdsWithOpenReviewSignals(organizationId, baseWhere),
    countContractsWithoutCounterparty(organizationId, baseWhere),
    countContractsWithoutExtraction(organizationId, baseWhere),
    countContractsWithoutSegmentation(organizationId, baseWhere),
    countContractsWithoutEndDateActive(organizationId, baseWhere),
    groupContractsByStoredStatus(organizationId, baseWhere),
    sumContractAmountsByCurrency(organizationId, withDisplayStatus(baseWhere, ContractStatus.ACTIVE, now)),
    sumContractAmountsByCurrency(organizationId, withDisplayStatus(baseWhere, ContractStatus.EXPIRING, now)),
    sumContractAmountsByCurrency(organizationId, { AND: [baseWhere, { autoRenewal: true }] }),
    countLiveContracts(organizationId, { AND: [baseWhere, { amount: null }] }),
    // Display status counts are one COUNT per status via the same
    // buildDisplayStatusWhere() fragments used above - not a groupBy,
    // because EXPIRING/EXPIRED/ACTIVE's SQL translation is status-and-date
    // conditional, not a plain column GROUP BY.
    Promise.all(
      allStatuses.map(
        async (status) =>
          [status, await countLiveContracts(organizationId, withDisplayStatus(baseWhere, status, now))] as const
      )
    ),
  ]);

  const storedStatusCounts = Object.fromEntries(allStatuses.map((s) => [s, 0])) as Record<
    ContractStatus,
    number
  >;
  for (const row of storedStatusRows) {
    storedStatusCounts[row.status] = row.count;
  }

  const displayStatusCounts = Object.fromEntries(displayStatusEntries) as Record<ContractStatus, number>;

  return {
    totalLive,
    inProgress,
    expiringWithin30Days,
    alreadyExpired,
    autoRenewalCount,
    contractsWithOpenSignals: openSignalContractIds.size,
    contractsWithoutCounterparty,
    contractsMissingExtraction,
    contractsMissingSegmentation,
    contractsWithoutEndDateActive,
    storedStatusCounts,
    displayStatusCounts,
    activeAmountsByCurrency: toCurrencyView(activeAmounts),
    expiringSoonAmountsByCurrency: toCurrencyView(expiringSoonAmounts),
    autoRenewalAmountsByCurrency: toCurrencyView(autoRenewalAmounts),
    contractsWithoutAmount,
    asOf: now.toISOString(),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: period.applied ? "createdAt" : undefined,
      periodApplied: period.applied,
      now,
    }),
  };
}
