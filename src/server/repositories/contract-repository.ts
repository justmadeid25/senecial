import type { ContractType, ContractStatus } from "@/generated/prisma/enums";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

/** Accepts either the global client or a $transaction callback's tx client. */
type DbClient = PrismaClient | Prisma.TransactionClient;

const counterpartyInclude = {
  counterparty: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ContractInclude;

export type ContractWithCounterparty = Prisma.ContractGetPayload<{
  include: typeof counterpartyInclude;
}>;

export interface CreateContractData {
  organizationId: string;
  createdById: string;
  title: string;
  contractNumber?: string;
  contractType: ContractType;
  status: ContractStatus;
  startDate?: Date | null;
  endDate?: Date | null;
  signedDate?: Date | null;
  autoRenewal: boolean;
  noticePeriodDays?: number | null;
  amount?: Prisma.Decimal | null;
  currency?: string;
  governingLaw?: string;
  jurisdiction?: string;
  description?: string;
  counterpartyId?: string | null;
}

export interface UpdateContractData {
  title?: string;
  contractNumber?: string | null;
  contractType?: ContractType;
  status?: ContractStatus;
  startDate?: Date | null;
  endDate?: Date | null;
  signedDate?: Date | null;
  autoRenewal?: boolean;
  noticePeriodDays?: number | null;
  amount?: Prisma.Decimal | null;
  currency?: string;
  governingLaw?: string | null;
  jurisdiction?: string | null;
  description?: string | null;
  counterpartyId?: string | null;
}

/**
 * Every function below requires organizationId as an explicit argument and
 * always merges it into the query's where clause *last*, after any
 * caller-supplied filters - so a filter object can never accidentally (or
 * maliciously) override the organization scope. deletedAt: null is applied
 * the same way everywhere a "live" contract is expected.
 */

export async function createContract(
  data: CreateContractData,
  client: DbClient = prisma
): Promise<ContractWithCounterparty> {
  return client.contract.create({
    data,
    include: counterpartyInclude,
  });
}

export async function findContractById(
  params: { organizationId: string; contractId: string },
  client: DbClient = prisma
): Promise<ContractWithCounterparty | null> {
  return client.contract.findFirst({
    where: {
      id: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    include: counterpartyInclude,
  });
}

export interface FindContractsParams {
  organizationId: string;
  where?: Prisma.ContractWhereInput;
  orderBy?: Prisma.ContractOrderByWithRelationInput | Prisma.ContractOrderByWithRelationInput[];
  skip?: number;
  take?: number;
}

export async function findContracts(
  params: FindContractsParams,
  client: DbClient = prisma
): Promise<ContractWithCounterparty[]> {
  return client.contract.findMany({
    where: {
      ...params.where,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    orderBy: params.orderBy,
    skip: params.skip,
    take: params.take,
    include: counterpartyInclude,
  });
}

export async function countContracts(
  params: { organizationId: string; where?: Prisma.ContractWhereInput },
  client: DbClient = prisma
): Promise<number> {
  return client.contract.count({
    where: {
      ...params.where,
      organizationId: params.organizationId,
      deletedAt: null,
    },
  });
}

/**
 * Updates a contract scoped to (organizationId, contractId, deletedAt: null)
 * using updateMany rather than a plain id-based update, so it is
 * structurally impossible to touch another organization's row. Returns the
 * updated row, or null if nothing matched (wrong org, wrong id, or already
 * soft-deleted).
 */
export async function updateContract(
  params: { organizationId: string; contractId: string; data: UpdateContractData },
  client: DbClient = prisma
): Promise<ContractWithCounterparty | null> {
  const result = await client.contract.updateMany({
    where: {
      id: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    data: params.data,
  });

  if (result.count === 0) {
    return null;
  }

  return findContractById(
    { organizationId: params.organizationId, contractId: params.contractId },
    client
  );
}

/**
 * Soft-deletes a contract the same org-scoped updateMany way. Idempotent by
 * construction: an already-deleted contract no longer matches
 * `deletedAt: null`, so a second call safely returns null instead of
 * touching it again.
 */
export async function softDeleteContract(
  params: { organizationId: string; contractId: string; deletedAt: Date },
  client: DbClient = prisma
): Promise<ContractWithCounterparty | null> {
  const result = await client.contract.updateMany({
    where: {
      id: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    data: { deletedAt: params.deletedAt },
  });

  if (result.count === 0) {
    return null;
  }

  return client.contract.findFirst({
    where: { id: params.contractId, organizationId: params.organizationId },
    include: counterpartyInclude,
  });
}
