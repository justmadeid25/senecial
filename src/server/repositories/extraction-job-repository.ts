import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ExtractionJobStatus, ExtractionStage } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ExtractionJobRow = Prisma.ContractExtractionJobGetPayload<Record<string, never>>;

export interface CreateExtractionJobData {
  organizationId: string;
  contractId: string;
  contractFileId: string;
  extractorVersion: string;
  inputChecksum: string;
  createdById: string;
  maxAttempts?: number;
}

export async function createExtractionJob(
  data: CreateExtractionJobData,
  client: DbClient = prisma
): Promise<ExtractionJobRow> {
  return client.contractExtractionJob.create({ data });
}

export async function findExtractionJobById(
  params: { organizationId: string; contractId: string; jobId: string },
  client: DbClient = prisma
): Promise<ExtractionJobRow | null> {
  return client.contractExtractionJob.findFirst({
    where: {
      id: params.jobId,
      contractId: params.contractId,
      organizationId: params.organizationId,
    },
  });
}

/** Scoped to organizationId even though contractFileId alone would already be unambiguous - defense in depth, matches every other repository's pattern. */
export async function findExtractionJobByDedupKey(
  params: {
    organizationId: string;
    contractFileId: string;
    inputChecksum: string;
    extractorVersion: string;
  },
  client: DbClient = prisma
): Promise<ExtractionJobRow | null> {
  const row = await client.contractExtractionJob.findUnique({
    where: {
      contractFileId_inputChecksum_extractorVersion: {
        contractFileId: params.contractFileId,
        inputChecksum: params.inputChecksum,
        extractorVersion: params.extractorVersion,
      },
    },
  });
  return row && row.organizationId === params.organizationId ? row : null;
}

export async function findExtractionJobsByContract(
  params: { organizationId: string; contractId: string },
  client: DbClient = prisma
): Promise<ExtractionJobRow[]> {
  return client.contractExtractionJob.findMany({
    where: { organizationId: params.organizationId, contractId: params.contractId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Owns its own transaction and deliberately does NOT accept an outer
 * `client` the way every other repository function here does - `FOR
 * UPDATE SKIP LOCKED` must be the first statement of its transaction, and
 * the claiming UPDATE right after it must run on the exact same DB
 * connection to keep the row lock held between the two statements. Only
 * Prisma's interactive `$transaction()` guarantees that; a caller-supplied
 * client could be a connection with unrelated state already in flight.
 */
export async function claimNextPendingJob(workerId: string): Promise<ExtractionJobRow | null> {
  return prisma.$transaction(async (tx) => {
    const claimable = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "contract_extraction_jobs"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const claimedId = claimable[0]?.id;
    if (!claimedId) {
      return null;
    }

    return tx.contractExtractionJob.update({
      where: { id: claimedId },
      data: {
        status: ExtractionJobStatus.PROCESSING,
        stage: ExtractionStage.FILE_TEXT_EXTRACTION,
        startedAt: new Date(),
        attempt: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });
  });
}

export interface UpdateExtractionJobData {
  status?: ExtractionJobStatus;
  stage?: ExtractionStage | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  contractUpdatedAtSnapshot?: Date | null;
  warnings?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  lockedAt?: Date | null;
  lockedBy?: string | null;
}

export async function updateExtractionJob(
  params: { jobId: string; data: UpdateExtractionJobData },
  client: DbClient = prisma
): Promise<ExtractionJobRow> {
  return client.contractExtractionJob.update({
    where: { id: params.jobId },
    data: params.data,
  });
}

/** FAILED -> PENDING, reusing the same row (see domain/extraction/job-state-machine.ts). */
export async function resetExtractionJobToPending(
  jobId: string,
  client: DbClient = prisma
): Promise<ExtractionJobRow> {
  return client.contractExtractionJob.update({
    where: { id: jobId },
    data: {
      status: ExtractionJobStatus.PENDING,
      stage: null,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function findStaleProcessingJobs(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<ExtractionJobRow[]> {
  return client.contractExtractionJob.findMany({
    where: {
      status: ExtractionJobStatus.PROCESSING,
      lockedAt: { lte: staleBefore },
    },
  });
}
