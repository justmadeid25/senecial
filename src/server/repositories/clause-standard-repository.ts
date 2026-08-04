import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { ClauseType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ClauseStandardRow = Prisma.ClauseStandardGetPayload<Record<string, never>>;

export interface CreateClauseStandardData {
  organizationId: string;
  name: string;
  clauseType: ClauseType;
  title?: string | null;
  text: string;
  normalizedText: string;
  description?: string | null;
  isActive?: boolean;
  createdById: string;
}

export async function createClauseStandard(
  data: CreateClauseStandardData,
  client: DbClient = prisma
): Promise<ClauseStandardRow> {
  return client.clauseStandard.create({ data });
}

export async function findClauseStandardById(
  params: { organizationId: string; standardId: string },
  client: DbClient = prisma
): Promise<ClauseStandardRow | null> {
  return client.clauseStandard.findFirst({
    where: { id: params.standardId, organizationId: params.organizationId, deletedAt: null },
  });
}

export async function findClauseStandardsByType(
  params: { organizationId: string; clauseType: ClauseType; activeOnly?: boolean },
  client: DbClient = prisma
): Promise<ClauseStandardRow[]> {
  return client.clauseStandard.findMany({
    where: {
      organizationId: params.organizationId,
      clauseType: params.clauseType,
      deletedAt: null,
      ...(params.activeOnly ? { isActive: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listClauseStandards(
  params: { organizationId: string },
  client: DbClient = prisma
): Promise<ClauseStandardRow[]> {
  return client.clauseStandard.findMany({
    where: { organizationId: params.organizationId, deletedAt: null },
    orderBy: [{ clauseType: "asc" }, { name: "asc" }],
  });
}

export interface UpdateClauseStandardData {
  name?: string;
  clauseType?: ClauseType;
  title?: string | null;
  text?: string;
  normalizedText?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateClauseStandard(
  params: { organizationId: string; standardId: string; data: UpdateClauseStandardData },
  client: DbClient = prisma
): Promise<ClauseStandardRow | null> {
  const result = await client.clauseStandard.updateMany({
    where: { id: params.standardId, organizationId: params.organizationId, deletedAt: null },
    data: params.data,
  });
  if (result.count === 0) {
    return null;
  }
  return client.clauseStandard.findUnique({ where: { id: params.standardId } });
}

export async function softDeleteClauseStandard(
  params: { organizationId: string; standardId: string },
  client: DbClient = prisma
): Promise<ClauseStandardRow | null> {
  const result = await client.clauseStandard.updateMany({
    where: { id: params.standardId, organizationId: params.organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) {
    return null;
  }
  return client.clauseStandard.findUnique({ where: { id: params.standardId } });
}
