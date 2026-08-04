import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  ClauseReviewSignalStatus,
  ClauseReviewSignalType,
  ClauseType,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ClauseReviewSignalRow = Prisma.ClauseReviewSignalGetPayload<Record<string, never>>;

export interface CreateClauseReviewSignalData {
  organizationId: string;
  contractId: string;
  contractClauseId?: string | null;
  clauseStandardId?: string | null;
  clauseType?: ClauseType | null;
  signalType: ClauseReviewSignalType;
  title: string;
  description: string;
  evidenceText?: string | null;
  ruleVersion: string;
  signalKey: string;
}

/** No-op on an empty array, matching Phase 6's createFieldSuggestions(). */
export async function createClauseReviewSignals(
  rows: CreateClauseReviewSignalData[],
  client: DbClient = prisma
): Promise<{ count: number }> {
  if (rows.length === 0) {
    return { count: 0 };
  }
  return client.clauseReviewSignal.createMany({ data: rows, skipDuplicates: true });
}

export async function findClauseReviewSignalById(
  params: { organizationId: string; contractId: string; signalId: string },
  client: DbClient = prisma
): Promise<ClauseReviewSignalRow | null> {
  return client.clauseReviewSignal.findFirst({
    where: {
      id: params.signalId,
      contractId: params.contractId,
      organizationId: params.organizationId,
    },
  });
}

export async function listClauseReviewSignalsForContract(
  params: {
    organizationId: string;
    contractId: string;
    status?: ClauseReviewSignalStatus;
    signalType?: ClauseReviewSignalType;
    clauseType?: ClauseType;
  },
  client: DbClient = prisma
): Promise<ClauseReviewSignalRow[]> {
  return client.clauseReviewSignal.findMany({
    where: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.signalType ? { signalType: params.signalType } : {}),
      ...(params.clauseType ? { clauseType: params.clauseType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/** All signals (any status) tied to one clause - used to link an AI-generated review back to the existing rule-based signal for the same clause (§AI Review "linked to existing ClauseReviewSignal"). */
export async function findClauseReviewSignalsForClause(
  params: { organizationId: string; contractId: string; contractClauseId: string },
  client: DbClient = prisma
): Promise<ClauseReviewSignalRow[]> {
  return client.clauseReviewSignal.findMany({
    where: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      contractClauseId: params.contractClauseId,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findClauseReviewSignalByKey(
  signalKey: string,
  client: DbClient = prisma
): Promise<ClauseReviewSignalRow | null> {
  return client.clauseReviewSignal.findUnique({ where: { signalKey } });
}

export interface UpdateClauseReviewSignalData {
  status: ClauseReviewSignalStatus;
  reviewedById: string;
  reviewedAt: Date;
  reviewNote?: string | null;
}

export async function updateClauseReviewSignal(
  params: { organizationId: string; signalId: string; data: UpdateClauseReviewSignalData },
  client: DbClient = prisma
): Promise<ClauseReviewSignalRow | null> {
  const result = await client.clauseReviewSignal.updateMany({
    where: { id: params.signalId, organizationId: params.organizationId },
    data: params.data,
  });
  if (result.count === 0) {
    return null;
  }
  return client.clauseReviewSignal.findUnique({ where: { id: params.signalId } });
}
