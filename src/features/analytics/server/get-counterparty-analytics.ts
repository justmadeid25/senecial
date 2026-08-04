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
  countLiveContracts,
  groupContractsByCounterparty,
  listLiveCounterparties,
  sumContractAmountsByCounterpartyAndCurrency,
} from "@/server/repositories/analytics-repository";
import { prisma } from "@/server/db/client";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

export interface GetCounterpartyAnalyticsParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface CounterpartyCurrencyAmount {
  currency: string;
  total: string;
}

export interface CounterpartyAnalyticsRow {
  counterpartyId: string;
  counterpartyName: string;
  liveCount: number;
  inProgressCount: number;
  expiringWithin30Days: number;
  autoRenewalCount: number;
  openReviewSignalCount: number;
  amountsByCurrency: CounterpartyCurrencyAmount[];
  lastUpdatedAt: string | null;
}

export interface CounterpartyAnalytics {
  rows: CounterpartyAnalyticsRow[];
  asOf: string;
  scope: AnalyticsScopeMetadata;
}

/**
 * §19 - never assigns a trust/risk grade to a counterparty (see banned
 * phrasing in §3) - every figure here is a plain count or a currency-
 * separated sum of the counterparty's own contracts.
 *
 * Phase 8.1: contractType/displayStatus/currency/autoRenewal narrow which
 * contracts count toward each row; counterpartyId (when set) narrows the
 * ROW SET itself to that one counterparty (§5's "상대방 필터가 지정되면
 * 해당 상대방만 반환"). Contracts with no counterparty are never included
 * here by construction (this section groups BY counterparty).
 */
export async function getCounterpartyAnalytics(
  params: GetCounterpartyAnalyticsParams
): Promise<CounterpartyAnalytics> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.counterparties;
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

  const [counterparties, aggregates, amounts, openSignalContractIds] = await Promise.all([
    listLiveCounterparties(organizationId),
    groupContractsByCounterparty(organizationId, baseWhere),
    sumContractAmountsByCounterpartyAndCurrency(organizationId, baseWhere),
    contractIdsWithOpenReviewSignals(organizationId, baseWhere),
  ]);

  const aggregateById = new Map(aggregates.map((row) => [row.counterpartyId, row]));
  const amountsById = new Map<string, CounterpartyCurrencyAmount[]>();
  for (const row of amounts) {
    const list = amountsById.get(row.counterpartyId) ?? [];
    list.push({ currency: row.currency, total: row.total.toString() });
    amountsById.set(row.counterpartyId, list);
  }

  // Contracts-with-open-signals and per-counterparty in-progress/expiring
  // counts need the counterparty->contract link, so these are the only two
  // metrics fetched per counterparty rather than a single groupBy (Prisma's
  // groupBy can't express "distinct contract count that also has an open
  // signal, grouped by an unrelated FK" in one call).
  const contractsByCounterparty = await prisma.contract.findMany({
    where: { ...baseWhere, counterpartyId: { not: null } },
    select: { id: true, counterpartyId: true },
  });
  const contractIdsByCounterparty = new Map<string, string[]>();
  for (const row of contractsByCounterparty) {
    if (!row.counterpartyId) continue;
    const list = contractIdsByCounterparty.get(row.counterpartyId) ?? [];
    list.push(row.id);
    contractIdsByCounterparty.set(row.counterpartyId, list);
  }

  const rows = await Promise.all(
    counterparties.map(async (counterparty) => {
      const aggregate = aggregateById.get(counterparty.id);
      const contractIds = contractIdsByCounterparty.get(counterparty.id) ?? [];
      const openReviewSignalCount = contractIds.filter((id) => openSignalContractIds.has(id)).length;

      const [inProgressCount, expiringWithin30Days] = await Promise.all([
        countLiveContracts(organizationId, {
          AND: [baseWhere, { counterpartyId: counterparty.id }, buildDisplayStatusWhere(ContractStatus.ACTIVE, now)],
        }),
        countLiveContracts(organizationId, {
          AND: [baseWhere, { counterpartyId: counterparty.id }, buildDisplayStatusWhere(ContractStatus.EXPIRING, now)],
        }),
      ]);

      const row: CounterpartyAnalyticsRow = {
        counterpartyId: counterparty.id,
        counterpartyName: counterparty.name,
        liveCount: aggregate?.liveCount ?? 0,
        inProgressCount,
        expiringWithin30Days,
        autoRenewalCount: aggregate?.autoRenewalCount ?? 0,
        openReviewSignalCount,
        amountsByCurrency: amountsById.get(counterparty.id) ?? [],
        lastUpdatedAt: aggregate?.lastUpdatedAt?.toISOString() ?? null,
      };
      return row;
    })
  );

  return {
    rows: rows.filter((row) => row.liveCount > 0).sort((a, b) => b.liveCount - a.liveCount),
    asOf: now.toISOString(),
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "createdAt",
      periodApplied: period.applied,
      now,
    }),
  };
}
