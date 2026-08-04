import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { DataPurgeJobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type DataPurgeJobRow = Prisma.DataPurgeJobGetPayload<Record<string, never>>;

export interface RegisterPurgeJobInput {
  organizationId: string | null;
  entityType: string;
  entityId: string;
  scheduledFor: Date;
}

/**
 * Idempotent registration - the @@unique([entityType, entityId]) constraint
 * means calling this repeatedly for the same entity (e.g. every
 * `retention:scan` run before the job is actually purged) never creates a
 * duplicate row. Uses upsert with a no-op update so an already-COMPLETED or
 * already-PROCESSING row is never silently reset back to PENDING.
 */
export async function registerPurgeJob(
  input: RegisterPurgeJobInput,
  client: DbClient = prisma
): Promise<DataPurgeJobRow> {
  return client.dataPurgeJob.upsert({
    where: { entityType_entityId: { entityType: input.entityType, entityId: input.entityId } },
    create: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      scheduledFor: input.scheduledFor,
      status: DataPurgeJobStatus.PENDING,
    },
    update: {},
  });
}

/**
 * Atomically claims up to `limit` purge-eligible jobs (PENDING, or FAILED
 * with attempts remaining, whose scheduledFor has arrived and which are not
 * currently locked) by flipping them to PROCESSING with a lock owner/
 * timestamp. Uses updateMany + a follow-up read rather than a single
 * `SELECT ... FOR UPDATE SKIP LOCKED` since Prisma has no native support
 * for the latter - acceptable at this workload's scale (purge runs are
 * infrequent batch jobs, not a high-throughput queue).
 */
export async function claimPurgeJobs(
  params: { now: Date; limit: number; lockedBy: string },
  client: DbClient = prisma
): Promise<DataPurgeJobRow[]> {
  // attempt < maxAttempts compares two columns on the same row, which
  // Prisma's fluent API cannot express - so FAILED rows are over-fetched
  // here and narrowed with the JS filter below (same tradeoff documented
  // for countMaxAttemptsReachedJobs in analytics-repository.ts).
  const candidates = await client.dataPurgeJob.findMany({
    where: {
      scheduledFor: { lte: params.now },
      status: { in: [DataPurgeJobStatus.PENDING, DataPurgeJobStatus.FAILED] },
    },
    orderBy: { scheduledFor: "asc" },
    take: params.limit * 4,
  });

  const claimable = candidates
    .filter((job) => job.status === DataPurgeJobStatus.PENDING || job.attempt < job.maxAttempts)
    .slice(0, params.limit);

  const claimed: DataPurgeJobRow[] = [];
  for (const job of claimable) {
    const result = await client.dataPurgeJob.updateMany({
      where: { id: job.id, status: job.status },
      data: {
        status: DataPurgeJobStatus.PROCESSING,
        lockedAt: params.now,
        lockedBy: params.lockedBy,
        startedAt: params.now,
      },
    });
    if (result.count === 1) {
      const locked = await client.dataPurgeJob.findUnique({ where: { id: job.id } });
      if (locked) {
        claimed.push(locked);
      }
    }
  }
  return claimed;
}

export async function markPurgeJobCompleted(
  jobId: string,
  now: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.dataPurgeJob.update({
    where: { id: jobId },
    data: {
      status: DataPurgeJobStatus.COMPLETED,
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      errorCode: null,
      errorMessage: null,
    },
  });
}

/**
 * `errorMessage` must already be a safe, generic classification (never a
 * raw exception message or anything that could embed row content) - see
 * domain/retention/safe-purge-error.ts.
 */
export async function markPurgeJobFailed(
  params: { jobId: string; now: Date; errorCode: string; errorMessage: string },
  client: DbClient = prisma
): Promise<void> {
  await client.dataPurgeJob.update({
    where: { id: params.jobId },
    data: {
      status: DataPurgeJobStatus.FAILED,
      failedAt: params.now,
      attempt: { increment: 1 },
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function countPurgeJobsByStatus(
  client: DbClient = prisma
): Promise<Record<string, number>> {
  const grouped = await client.dataPurgeJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
}
