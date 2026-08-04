import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

/** Accepts either the global client or a $transaction callback's tx client. */
type DbClient = PrismaClient | Prisma.TransactionClient;

export type CounterpartyRow = Prisma.CounterpartyGetPayload<Record<string, never>>;

export interface CreateCounterpartyData {
  organizationId: string;
  name: string;
  businessNumber?: string;
  representativeName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  memo?: string;
}

export interface UpdateCounterpartyData {
  name?: string;
  businessNumber?: string | null;
  representativeName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  memo?: string | null;
}

/**
 * Every function below requires organizationId as an explicit argument and
 * always merges it into the query's where clause *last*, mirroring
 * contract-repository.ts - a caller-supplied filter object can never
 * accidentally (or maliciously) override the organization scope.
 */

export async function createCounterparty(
  data: CreateCounterpartyData,
  client: DbClient = prisma
): Promise<CounterpartyRow> {
  return client.counterparty.create({ data });
}

export async function findCounterpartyById(
  params: { organizationId: string; counterpartyId: string },
  client: DbClient = prisma
): Promise<CounterpartyRow | null> {
  return client.counterparty.findFirst({
    where: {
      id: params.counterpartyId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
  });
}

export interface FindCounterpartiesParams {
  organizationId: string;
  where?: Prisma.CounterpartyWhereInput;
  orderBy?:
    | Prisma.CounterpartyOrderByWithRelationInput
    | Prisma.CounterpartyOrderByWithRelationInput[];
  skip?: number;
  take?: number;
}

export async function findCounterparties(
  params: FindCounterpartiesParams,
  client: DbClient = prisma
): Promise<CounterpartyRow[]> {
  return client.counterparty.findMany({
    where: {
      ...params.where,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    orderBy: params.orderBy,
    skip: params.skip,
    take: params.take,
  });
}

export async function countCounterparties(
  params: { organizationId: string; where?: Prisma.CounterpartyWhereInput },
  client: DbClient = prisma
): Promise<number> {
  return client.counterparty.count({
    where: {
      ...params.where,
      organizationId: params.organizationId,
      deletedAt: null,
    },
  });
}

/**
 * Counts *live* (non-soft-deleted) contracts still linked to this
 * counterparty, scoped to the same organization. Used to block deletion -
 * see delete-counterparty.ts.
 */
export async function countLinkedContracts(
  params: { organizationId: string; counterpartyId: string },
  client: DbClient = prisma
): Promise<number> {
  return client.contract.count({
    where: {
      organizationId: params.organizationId,
      counterpartyId: params.counterpartyId,
      deletedAt: null,
    },
  });
}

/**
 * Updates a counterparty scoped to (organizationId, counterpartyId,
 * deletedAt: null) using updateMany rather than a plain id-based update, so
 * it is structurally impossible to touch another organization's row.
 * Returns the updated row, or null if nothing matched.
 */
export async function updateCounterparty(
  params: { organizationId: string; counterpartyId: string; data: UpdateCounterpartyData },
  client: DbClient = prisma
): Promise<CounterpartyRow | null> {
  const result = await client.counterparty.updateMany({
    where: {
      id: params.counterpartyId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    data: params.data,
  });

  if (result.count === 0) {
    return null;
  }

  return findCounterpartyById(
    { organizationId: params.organizationId, counterpartyId: params.counterpartyId },
    client
  );
}

/**
 * Soft-deletes a counterparty the same org-scoped updateMany way. An
 * already-deleted counterparty no longer matches `deletedAt: null`, so a
 * second call safely returns null instead of touching it again.
 */
export async function softDeleteCounterparty(
  params: { organizationId: string; counterpartyId: string; deletedAt: Date },
  client: DbClient = prisma
): Promise<CounterpartyRow | null> {
  const result = await client.counterparty.updateMany({
    where: {
      id: params.counterpartyId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    data: { deletedAt: params.deletedAt },
  });

  if (result.count === 0) {
    return null;
  }

  return client.counterparty.findFirst({
    where: { id: params.counterpartyId, organizationId: params.organizationId },
  });
}
