import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { EmbeddingJobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type EmbeddingJobRow = Prisma.EmbeddingJobGetPayload<Record<string, never>>;

export interface CreateEmbeddingJobData {
  organizationId: string;
  contractClauseId: string;
  inputChecksum: string;
  maxAttempts?: number;
}

/**
 * §Embedding Job - a duplicate enqueue (same clause, same checksum - i.e.
 * the clause's normalizedText did not actually change) is a silent no-op,
 * matching mail-delivery-repository.ts's enqueuePendingMailDelivery()'s
 * identical "duplicate insert is safe" handling via the same P2002 catch.
 */
export async function enqueueEmbeddingJob(
  data: CreateEmbeddingJobData,
  client: DbClient = prisma
): Promise<EmbeddingJobRow | null> {
  try {
    return await client.embeddingJob.create({
      data: {
        organizationId: data.organizationId,
        contractClauseId: data.contractClauseId,
        inputChecksum: data.inputChecksum,
        maxAttempts: data.maxAttempts,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * Owns its own transaction - `FOR UPDATE SKIP LOCKED` must be the first
 * statement of its transaction and the claiming UPDATE must run on the
 * same connection, exactly like claimNextPendingJob()
 * (extraction-job-repository.ts) / claimNextPendingClauseSegmentationJob().
 */
export async function claimNextPendingEmbeddingJob(workerId: string): Promise<EmbeddingJobRow | null> {
  return prisma.$transaction(async (tx) => {
    const claimable = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "embedding_jobs"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const claimedId = claimable[0]?.id;
    if (!claimedId) {
      return null;
    }

    return tx.embeddingJob.update({
      where: { id: claimedId },
      data: {
        status: EmbeddingJobStatus.PROCESSING,
        startedAt: new Date(),
        attempt: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });
  });
}

export interface UpdateEmbeddingJobData {
  status?: EmbeddingJobStatus;
  completedAt?: Date | null;
  failedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  model?: string | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
}

export async function updateEmbeddingJob(
  params: { jobId: string; data: UpdateEmbeddingJobData },
  client: DbClient = prisma
): Promise<EmbeddingJobRow> {
  return client.embeddingJob.update({ where: { id: params.jobId }, data: params.data });
}

/** FAILED -> PENDING, reusing the same row - same shape as resetExtractionJobToPending(). */
export async function resetEmbeddingJobToPending(jobId: string, client: DbClient = prisma): Promise<EmbeddingJobRow> {
  return client.embeddingJob.update({
    where: { id: jobId },
    data: {
      status: EmbeddingJobStatus.PENDING,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function findStaleProcessingEmbeddingJobs(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<EmbeddingJobRow[]> {
  return client.embeddingJob.findMany({
    where: { status: EmbeddingJobStatus.PROCESSING, lockedAt: { lte: staleBefore } },
  });
}
