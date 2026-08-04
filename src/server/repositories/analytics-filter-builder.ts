import { Prisma } from "@/generated/prisma/client";
import type { ContractStatus, ContractType } from "@/generated/prisma/enums";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

/**
 * Phase 8.1 - the one shared shape every analytics section's contract-level
 * filtering goes through. `createdFrom`/`createdTo` and
 * `endDateFrom`/`endDateTo` are two SEPARATE date bases (a section picks
 * whichever one its own §2 dateBasis calls for - see
 * domain/analytics/filter-matrix.ts) - never both at once from the same
 * periodStart/periodEnd input.
 */
export interface ContractAnalyticsFilter {
  contractType?: ContractType;
  displayStatus?: ContractStatus;
  counterpartyId?: string;
  currency?: string;
  autoRenewal?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  endDateFrom?: Date;
  endDateTo?: Date;
}

/**
 * §3 - the single, structurally-enforced entry point for turning analytics
 * filters into a Prisma.ContractWhereInput. `organizationId` and
 * `deletedAt: null` are always merged as top-level keys on the RETURNED
 * object (never inside the caller-influenced `AND` array), so no filter
 * value this function receives can ever widen scope past this
 * organization's live contracts - the same "merge org scope last, never
 * spread over it" convention as contract-repository.ts.
 *
 * The returned object is also what gets passed as a `contract: {...}`
 * relation filter when propagating this same contract-level filter into
 * clause/signal/job queries (§5) - one builder, reused everywhere, so the
 * screen and CSV export can never drift apart (§9).
 */
export function buildContractAnalyticsWhere(
  organizationId: string,
  filter: ContractAnalyticsFilter,
  now: Date
): Prisma.ContractWhereInput {
  const conditions: Prisma.ContractWhereInput[] = [];

  if (filter.contractType) {
    conditions.push({ contractType: filter.contractType });
  }
  if (filter.displayStatus) {
    conditions.push(buildDisplayStatusWhere(filter.displayStatus, now));
  }
  if (filter.counterpartyId) {
    conditions.push({ counterpartyId: filter.counterpartyId });
  }
  if (filter.currency) {
    conditions.push({ currency: filter.currency });
  }
  if (filter.autoRenewal !== undefined) {
    conditions.push({ autoRenewal: filter.autoRenewal });
  }
  if (filter.createdFrom || filter.createdTo) {
    conditions.push({
      createdAt: {
        ...(filter.createdFrom ? { gte: filter.createdFrom } : {}),
        ...(filter.createdTo ? { lt: filter.createdTo } : {}),
      },
    });
  }
  if (filter.endDateFrom || filter.endDateTo) {
    conditions.push({
      endDate: {
        not: null,
        ...(filter.endDateFrom ? { gte: filter.endDateFrom } : {}),
        ...(filter.endDateTo ? { lt: filter.endDateTo } : {}),
      },
    });
  }

  return {
    ...(conditions.length > 0 ? { AND: conditions } : {}),
    organizationId,
    deletedAt: null,
  };
}
