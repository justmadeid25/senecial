import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { BatchExecutionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type BatchExecutionRow = Prisma.BatchExecutionGetPayload<Record<string, never>>;

export async function createRunningBatchExecution(
  data: { jobName: string; executionKey: string; startedAt: Date; lockedBy: string },
  client: DbClient = prisma
): Promise<BatchExecutionRow> {
  return client.batchExecution.create({
    data: { ...data, status: BatchExecutionStatus.RUNNING, heartbeatAt: data.startedAt },
  });
}

/**
 * Guarded by `status: RUNNING` in the WHERE clause (via `updateMany`, which
 * silently no-ops instead of throwing when zero rows match - unlike
 * `update`, which requires a unique match). This is what makes the row
 * transition safe against recover-stale-batch-executions.ts racing a live
 * worker: whichever of {a fresh heartbeat, a terminal transition, a stale
 * recovery} lands first in Postgres wins the row (single-statement atomic
 * UPDATE), and every loser's write simply becomes a no-op rather than
 * clobbering the winner. Returns whether this call's write actually took
 * effect, so callers can detect + log a "wrote after the row was already
 * moved out from under us" condition (see run-batch-job.ts).
 */
export async function touchBatchExecutionHeartbeat(
  id: string,
  now: Date,
  client: DbClient = prisma
): Promise<boolean> {
  const { count } = await client.batchExecution.updateMany({
    where: { id, status: BatchExecutionStatus.RUNNING },
    data: { heartbeatAt: now },
  });
  return count > 0;
}

export async function markBatchExecutionSucceeded(
  id: string,
  data: { completedAt: Date; processedCount: number; successCount: number; failureCount: number },
  client: DbClient = prisma
): Promise<boolean> {
  const { count } = await client.batchExecution.updateMany({
    where: { id, status: BatchExecutionStatus.RUNNING },
    data: { status: BatchExecutionStatus.SUCCEEDED, ...data },
  });
  return count > 0;
}

/** `errorCode` must already be a short, safe classification - never a raw exception message (see server/batch/safe-error-code.ts). */
export async function markBatchExecutionFailed(
  id: string,
  data: {
    completedAt: Date;
    errorCode: string;
    processedCount: number;
    successCount: number;
    failureCount: number;
  },
  client: DbClient = prisma
): Promise<boolean> {
  const { count } = await client.batchExecution.updateMany({
    where: { id, status: BatchExecutionStatus.RUNNING },
    data: { status: BatchExecutionStatus.FAILED, ...data },
  });
  return count > 0;
}

export async function findRecentBatchExecutions(
  jobName: string,
  limit: number,
  client: DbClient = prisma
): Promise<BatchExecutionRow[]> {
  return client.batchExecution.findMany({
    where: { jobName },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
