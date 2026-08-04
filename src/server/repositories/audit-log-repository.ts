import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const withUser = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude;

export type AuditLogWithUser = Prisma.AuditLogGetPayload<{ include: typeof withUser }>;

export interface FindAuditLogsParams {
  organizationId: string;
  action?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

/**
 * Unlike contract-repository.ts (which accepts a caller-built
 * Prisma.WhereInput passthrough for its dynamic search builder),
 * organizationId here is never at risk of being overridden by a caller -
 * every filter is an individually named, whitelisted parameter, not a raw
 * object a caller could smuggle an `organizationId` override into.
 */
function buildWhere(params: FindAuditLogsParams): Prisma.AuditLogWhereInput {
  return {
    organizationId: params.organizationId,
    ...(params.action ? { action: params.action } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.startDate || params.endDate
      ? {
          createdAt: {
            ...(params.startDate ? { gte: params.startDate } : {}),
            ...(params.endDate ? { lte: params.endDate } : {}),
          },
        }
      : {}),
  };
}

export async function findAuditLogs(
  params: FindAuditLogsParams,
  client: DbClient = prisma
): Promise<AuditLogWithUser[]> {
  return client.auditLog.findMany({
    where: buildWhere(params),
    include: withUser,
    orderBy: { createdAt: "desc" },
    skip: params.skip,
    take: params.take,
  });
}

export async function countAuditLogs(
  params: FindAuditLogsParams,
  client: DbClient = prisma
): Promise<number> {
  return client.auditLog.count({ where: buildWhere(params) });
}
