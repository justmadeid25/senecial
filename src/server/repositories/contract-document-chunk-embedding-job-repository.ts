import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { EmbeddingJobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ChunkEmbeddingJobRow = Prisma.ContractDocumentChunkEmbeddingJobGetPayload<Record<string, never>>;

export interface CreateChunkEmbeddingJobData {
  organizationId: string;
  chunkId: string;
  inputChecksum: string;
  maxAttempts?: number;
}

/** Mirrors enqueueEmbeddingJob() (embedding-job-repository.ts) exactly - a duplicate enqueue (same chunk, same checksum) is a silent no-op via the same P2002 catch. */
export async function enqueueChunkEmbeddingJob(
  data: CreateChunkEmbeddingJobData,
  client: DbClient = prisma
): Promise<ChunkEmbeddingJobRow | null> {
  try {
    return await client.contractDocumentChunkEmbeddingJob.create({
      data: {
        organizationId: data.organizationId,
        chunkId: data.chunkId,
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

/** Mirrors claimNextPendingEmbeddingJob() exactly - owns its own transaction, FOR UPDATE SKIP LOCKED must be the first statement. */
export async function claimNextPendingChunkEmbeddingJob(workerId: string): Promise<ChunkEmbeddingJobRow | null> {
  return prisma.$transaction(async (tx) => {
    const claimable = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "contract_document_chunk_embedding_jobs"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const claimedId = claimable[0]?.id;
    if (!claimedId) {
      return null;
    }

    return tx.contractDocumentChunkEmbeddingJob.update({
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

export interface UpdateChunkEmbeddingJobData {
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

export async function updateChunkEmbeddingJob(
  params: { jobId: string; data: UpdateChunkEmbeddingJobData },
  client: DbClient = prisma
): Promise<ChunkEmbeddingJobRow> {
  return client.contractDocumentChunkEmbeddingJob.update({ where: { id: params.jobId }, data: params.data });
}

export async function findStaleProcessingChunkEmbeddingJobs(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<ChunkEmbeddingJobRow[]> {
  return client.contractDocumentChunkEmbeddingJob.findMany({
    where: { status: EmbeddingJobStatus.PROCESSING, lockedAt: { lte: staleBefore } },
  });
}
