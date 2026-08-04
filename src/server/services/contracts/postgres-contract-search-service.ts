import { Prisma } from "@/generated/prisma/client";
import { ContractStatus } from "@/generated/prisma/enums";
import type {
  ContractSearchParams,
  ContractSearchResult,
  ContractSearchResultItem,
  ContractSearchService,
} from "@/domain/contracts/contract-search-service";
import {
  EXPIRING_WINDOW_DAYS,
  getComputedContractStatus,
  kstDayIndexToUtcStart,
  toKstDayIndex,
} from "@/domain/contracts/get-computed-contract-status";
import {
  countContracts,
  findContracts,
  type ContractWithCounterparty,
} from "@/server/repositories/contract-repository";

const MANUAL_STATUSES: ReadonlySet<ContractStatus> = new Set([
  ContractStatus.DRAFT,
  ContractStatus.TERMINATED,
  ContractStatus.ARCHIVED,
]);

/**
 * Translates a *display* status filter into a Prisma where fragment that
 * matches the exact rules in getComputedContractStatus(), so filtering
 * happens in SQL (correct pagination/counts) instead of fetch-then-discard
 * in JS. Kept in the server layer (not domain) since it returns a
 * Prisma-specific type - domain stays free of infrastructure types.
 */
export function buildDisplayStatusWhere(
  displayStatus: ContractStatus,
  now: Date
): Prisma.ContractWhereInput {
  if (MANUAL_STATUSES.has(displayStatus)) {
    return { status: displayStatus };
  }

  const todayStart = kstDayIndexToUtcStart(toKstDayIndex(now));
  const windowEndExclusive = kstDayIndexToUtcStart(
    toKstDayIndex(now) + EXPIRING_WINDOW_DAYS + 1
  );

  switch (displayStatus) {
    case ContractStatus.EXPIRED:
      return {
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXPIRING, ContractStatus.EXPIRED] },
        endDate: { not: null, lt: todayStart },
      };
    case ContractStatus.EXPIRING:
      return {
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXPIRING] },
        endDate: { not: null, gte: todayStart, lt: windowEndExclusive },
      };
    case ContractStatus.ACTIVE:
      return {
        status: ContractStatus.ACTIVE,
        OR: [{ endDate: null }, { endDate: { gte: windowEndExclusive } }],
      };
    default:
      return { status: displayStatus };
  }
}

function buildOrderBy(
  sortBy: NonNullable<ContractSearchParams["sortBy"]>,
  sortOrder: NonNullable<ContractSearchParams["sortOrder"]>
): Prisma.ContractOrderByWithRelationInput {
  if (sortBy === "endDate") {
    return { endDate: { sort: sortOrder, nulls: "last" } };
  }
  return { [sortBy]: sortOrder };
}

function toResultItem(
  contract: ContractWithCounterparty,
  now: Date
): ContractSearchResultItem {
  return {
    id: contract.id,
    title: contract.title,
    contractNumber: contract.contractNumber,
    contractType: contract.contractType,
    storedStatus: contract.status,
    displayStatus: getComputedContractStatus(
      { status: contract.status, endDate: contract.endDate },
      now
    ),
    startDate: contract.startDate,
    endDate: contract.endDate,
    signedDate: contract.signedDate,
    autoRenewal: contract.autoRenewal,
    amount: contract.amount ? contract.amount.toString() : null,
    currency: contract.currency,
    counterparty: contract.counterparty,
    updatedAt: contract.updatedAt,
  };
}

export class PostgresContractSearchService implements ContractSearchService {
  async search(params: ContractSearchParams): Promise<ContractSearchResult> {
    const now = params.now ?? new Date();
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const sortBy = params.sortBy ?? "updatedAt";
    const sortOrder = params.sortOrder ?? "desc";

    const andConditions: Prisma.ContractWhereInput[] = [];

    const trimmedQuery = params.query?.trim();
    if (trimmedQuery) {
      andConditions.push({
        OR: [
          { title: { contains: trimmedQuery, mode: "insensitive" } },
          { contractNumber: { contains: trimmedQuery, mode: "insensitive" } },
          { description: { contains: trimmedQuery, mode: "insensitive" } },
          { counterparty: { name: { contains: trimmedQuery, mode: "insensitive" } } },
        ],
      });
    }

    if (params.contractType) {
      andConditions.push({ contractType: params.contractType });
    }

    if (params.autoRenewal !== undefined) {
      andConditions.push({ autoRenewal: params.autoRenewal });
    }

    if (params.counterpartyId) {
      andConditions.push({ counterpartyId: params.counterpartyId });
    }

    if (params.displayStatus) {
      andConditions.push(buildDisplayStatusWhere(params.displayStatus, now));
    }

    const where: Prisma.ContractWhereInput | undefined =
      andConditions.length > 0 ? { AND: andConditions } : undefined;

    const [contracts, total] = await Promise.all([
      findContracts({
        organizationId: params.organizationId,
        where,
        orderBy: buildOrderBy(sortBy, sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      countContracts({ organizationId: params.organizationId, where }),
    ]);

    return {
      items: contracts.map((contract) => toResultItem(contract, now)),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }
}

export const contractSearchService: ContractSearchService = new PostgresContractSearchService();
