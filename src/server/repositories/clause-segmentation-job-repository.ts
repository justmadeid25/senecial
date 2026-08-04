import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ClauseSegmentationJobRow = Prisma.ClauseSegmentationJobGetPayload<
  Record<string, never>
>;

export interface CreateClauseSegmentationJobData {
  organizationId: string;
  contractId: string;
  extractedDocumentId: string;
  segmenterVersion: string;
  inputChecksum: string;
  jobKey: string;
  createdById: string;
  maxAttempts?: number;
}

export async function createClauseSegmentationJob(
  data: CreateClauseSegmentationJobData,
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow> {
  return client.clauseSegmentationJob.create({ data });
}

export async function findClauseSegmentationJobById(
  params: { organizationId: string; contractId: string; jobId: string },
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow | null> {
  return client.clauseSegmentationJob.findFirst({
    where: {
      id: params.jobId,
      contractId: params.contractId,
      organizationId: params.organizationId,
    },
  });
}

/** Scoped to organizationId even though jobKey alone is already globally unique - defense in depth, matches Phase 6's findExtractionJobByDedupKey. */
export async function findClauseSegmentationJobByKey(
  params: { organizationId: string; jobKey: string },
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow | null> {
  const row = await client.clauseSegmentationJob.findUnique({ where: { jobKey: params.jobKey } });
  return row && row.organizationId === params.organizationId ? row : null;
}

/** Used to compute the "latest job per (contract, document)" set for org-wide clause search - see features/clauses/server/search-org-clauses.ts. */
export async function findReadyClauseSegmentationJobsByOrganization(
  organizationId: string,
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow[]> {
  return client.clauseSegmentationJob.findMany({
    where: {
      organizationId,
      status: { in: [ClauseSegmentationJobStatus.REVIEW_REQUIRED, ClauseSegmentationJobStatus.COMPLETED] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findClauseSegmentationJobsByContract(
  params: { organizationId: string; contractId: string },
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow[]> {
  return client.clauseSegmentationJob.findMany({
    where: { organizationId: params.organizationId, contractId: params.contractId },
    orderBy: { createdAt: "desc" },
  });
}

/** Same FOR UPDATE SKIP LOCKED claim pattern as extraction-job-repository.ts's claimNextPendingJob() - see that file's comment for why this deliberately does not accept an outer `client`. */
export async function claimNextPendingClauseSegmentationJob(
  workerId: string
): Promise<ClauseSegmentationJobRow | null> {
  return prisma.$transaction(async (tx) => {
    const claimable = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "clause_segmentation_jobs"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const claimedId = claimable[0]?.id;
    if (!claimedId) {
      return null;
    }

    return tx.clauseSegmentationJob.update({
      where: { id: claimedId },
      data: {
        status: ClauseSegmentationJobStatus.PROCESSING,
        startedAt: new Date(),
        attempt: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });
  });
}

export interface UpdateClauseSegmentationJobData {
  status?: ClauseSegmentationJobStatus;
  completedAt?: Date | null;
  failedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  warnings?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  lockedAt?: Date | null;
  lockedBy?: string | null;
}

export async function updateClauseSegmentationJob(
  params: { jobId: string; data: UpdateClauseSegmentationJobData },
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow> {
  return client.clauseSegmentationJob.update({
    where: { id: params.jobId },
    data: params.data,
  });
}

/** FAILED -> PENDING, reusing the same row (see domain/clauses/job-state-machine.ts). */
export async function resetClauseSegmentationJobToPending(
  jobId: string,
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow> {
  return client.clauseSegmentationJob.update({
    where: { id: jobId },
    data: {
      status: ClauseSegmentationJobStatus.PENDING,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function findStaleProcessingClauseSegmentationJobs(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<ClauseSegmentationJobRow[]> {
  return client.clauseSegmentationJob.findMany({
    where: {
      status: ClauseSegmentationJobStatus.PROCESSING,
      lockedAt: { lte: staleBefore },
    },
  });
}
