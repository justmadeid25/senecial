import type { Prisma } from "@/generated/prisma/client";
import { ContractStatus, ContractType } from "@/generated/prisma/enums";
import { ANALYTICS_FILTER_MATRIX } from "@/domain/analytics/filter-matrix";
import { safePercentage } from "@/domain/analytics/labels";
import { resolveSectionPeriod } from "@/domain/analytics/resolve-section-period";
import { buildScopeMetadata, presentFilterKeys, type AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";
import { ANALYTICS_DEFAULT_MONTHS, ANALYTICS_MAX_DATE_RANGE_MONTHS } from "@/lib/config/analytics";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilterInput } from "@/lib/validation/analytics";
import { buildContractAnalyticsWhere, type ContractAnalyticsFilter } from "@/server/repositories/analytics-filter-builder";
import {
  contractTypesWithOpenReviewSignals,
  countLiveContracts,
  groupContractsByType,
  sumContractAmountsByTypeAndCurrency,
} from "@/server/repositories/analytics-repository";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

export interface GetContractTypeAnalyticsParams {
  userId: string;
  organizationId: string;
  filters?: Partial<AnalyticsFilterInput>;
}

export interface ContractTypeCurrencyAmount {
  currency: string;
  total: string;
}

export interface ContractTypeAnalyticsRow {
  contractType: ContractType;
  count: number;
  percentageOfTotal: number;
  openReviewSignalContracts: number;
  expiringWithin30Days: number;
  contractsWithAmount: number;
  amountsByCurrency: ContractTypeCurrencyAmount[];
}

export interface ContractTypeAnalytics {
  total: number;
  rows: ContractTypeAnalyticsRow[];
  scope: AnalyticsScopeMetadata;
}

/**
 * §11 - contractType is a required, non-nullable enum column in this
 * schema (see prisma/schema.prisma), so there is no "미지정" contract to
 * bucket separately; every live contract has exactly one of the enum
 * values (OTHER is the catch-all already built into the enum). If the user
 * also filters by contractType, this breakdown correctly collapses to that
 * one row - it is still the same "계약 유형 분포" query, just narrowed.
 */
export async function getContractTypeAnalytics(
  params: GetContractTypeAnalyticsParams
): Promise<ContractTypeAnalytics> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const organizationId = authContext.organizationId;
  const now = new Date();
  const filters = params.filters ?? EMPTY_ANALYTICS_FILTERS;

  const section = ANALYTICS_FILTER_MATRIX.contractType;
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

  const [total, typeCounts, amountsByType, openSignalsByType, expiringCounts, amountCounts] =
    await Promise.all([
      countLiveContracts(organizationId, baseWhere),
      groupContractsByType(organizationId, baseWhere),
      sumContractAmountsByTypeAndCurrency(organizationId, baseWhere),
      contractTypesWithOpenReviewSignals(organizationId, baseWhere),
      Promise.all(
        Object.values(ContractType).map(
          async (contractType) =>
            [
              contractType,
              await countLiveContracts(organizationId, {
                AND: [baseWhere, { contractType }, buildDisplayStatusWhere(ContractStatus.EXPIRING, now)],
              }),
            ] as const
        )
      ),
      Promise.all(
        Object.values(ContractType).map(
          async (contractType) =>
            [
              contractType,
              await countLiveContracts(organizationId, {
                AND: [baseWhere, { contractType, amount: { not: null } }],
              } satisfies Prisma.ContractWhereInput),
            ] as const
        )
      ),
    ]);

  const countByType = new Map(typeCounts.map((row) => [row.contractType, row.count]));
  const expiringByType = new Map(expiringCounts);
  const amountCountByType = new Map(amountCounts);
  const amountsGrouped = new Map<ContractType, ContractTypeCurrencyAmount[]>();
  for (const row of amountsByType) {
    const list = amountsGrouped.get(row.contractType) ?? [];
    list.push({ currency: row.currency, total: row.total.toString() });
    amountsGrouped.set(row.contractType, list);
  }

  const rows: ContractTypeAnalyticsRow[] = Object.values(ContractType).map((contractType) => {
    const count = countByType.get(contractType) ?? 0;
    return {
      contractType,
      count,
      percentageOfTotal: safePercentage(count, total),
      openReviewSignalContracts: openSignalsByType.get(contractType)?.size ?? 0,
      expiringWithin30Days: expiringByType.get(contractType) ?? 0,
      contractsWithAmount: amountCountByType.get(contractType) ?? 0,
      amountsByCurrency: amountsGrouped.get(contractType) ?? [],
    };
  });

  return {
    total,
    rows,
    scope: buildScopeMetadata({
      presentFilterKeys: presentFilterKeys(filters),
      supportedFilterKeys: section.supportedFilterKeys,
      dateBasis: "createdAt",
      periodApplied: period.applied,
      now,
    }),
  };
}
