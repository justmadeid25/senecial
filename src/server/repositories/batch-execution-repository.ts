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

export async function touchBatchExecutionHeartbeat(
  id: string,
  now: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.batchExecution.update({ where: { id }, data: { heartbeatAt: now } });
}

export async function markBatchExecutionSucceeded(
  id: string,
  data: { completedAt: Date; processedCount: number; successCount: number; failureCount: number },
  client: DbClient = prisma
): Promise<void> {
  await client.batchExecution.update({
    where: { id },
    data: { status: BatchExecutionStatus.SUCCEEDED, ...data },
  });
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
): Promise<void> {
  await client.batchExecution.update({
    where: { id },
    data: { status: BatchExecutionStatus.FAILED, ...data },
  });
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
