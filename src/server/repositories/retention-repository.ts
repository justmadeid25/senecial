import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Phase 9 §5 - queries backing retention/purge. Contract purging goes
 * through DataPurgeJob (see data-purge-job-repository.ts and
 * features/retention/server/purge-contract.ts) because it is a multi-table,
 * multi-step operation that needs retry tracking and dry-run visibility.
 * Invitations/Notifications/terminally-failed jobs below are simple,
 * single-table, already-idempotent deleteMany operations with no physical
 * file or cascade complexity, so a DataPurgeJob row per row would only add
 * bookkeeping overhead with no corresponding benefit - they are purged
 * directly by the retention CLI instead (documented in README).
 */

export interface EligibleContractForPurge {
  id: string;
  organizationId: string;
  deletedAt: Date;
}

/** Soft-deleted contracts whose deletedAt is at or before `cutoff`. */
export async function findContractsEligibleForPurge(
  cutoff: Date,
  limit: number,
  client: DbClient = prisma
): Promise<EligibleContractForPurge[]> {
  return client.contract.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true, organizationId: true, deletedAt: true },
    orderBy: { deletedAt: "asc" },
    take: limit,
  }) as Promise<EligibleContractForPurge[]>;
}

export async function countContractsEligibleForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<{ contractCount: number; organizationCount: number }> {
  const [contractCount, orgGroups] = await Promise.all([
    client.contract.count({ where: { deletedAt: { not: null, lte: cutoff } } }),
    client.contract.groupBy({
      by: ["organizationId"],
      where: { deletedAt: { not: null, lte: cutoff } },
    }),
  ]);
  return { contractCount, organizationCount: orgGroups.length };
}

/** Estimated file/derived-row counts for a purge dry-run preview - counts only, never content (§7). */
export async function estimatePurgeImpact(
  contractIds: string[],
  client: DbClient = prisma
): Promise<{ fileCount: number; clauseCount: number; extractionJobCount: number }> {
  if (contractIds.length === 0) {
    return { fileCount: 0, clauseCount: 0, extractionJobCount: 0 };
  }
  const [fileCount, clauseCount, extractionJobCount] = await Promise.all([
    client.contractFile.count({ where: { contractId: { in: contractIds } } }),
    client.contractClause.count({ where: { contractId: { in: contractIds } } }),
    client.contractExtractionJob.count({ where: { contractId: { in: contractIds } } }),
  ]);
  return { fileCount, clauseCount, extractionJobCount };
}

/**
 * Invitations are purge-eligible RETENTION_INVITATION_DAYS after whichever
 * terminal event applies: acceptedAt, revokedAt, or (for one that was
 * simply never acted on) expiresAt. A still-pending, not-yet-expired
 * invitation is never eligible regardless of createdAt.
 */
export async function countExpiredInvitationsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<number> {
  return client.organizationInvitation.count({
    where: {
      OR: [
        { acceptedAt: { lte: cutoff } },
        { revokedAt: { lte: cutoff } },
        { AND: [{ acceptedAt: null }, { revokedAt: null }, { expiresAt: { lte: cutoff } }] },
      ],
    },
  });
}

export async function deleteExpiredInvitationsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<number> {
  const result = await client.organizationInvitation.deleteMany({
    where: {
      OR: [
        { acceptedAt: { lte: cutoff } },
        { revokedAt: { lte: cutoff } },
        { AND: [{ acceptedAt: null }, { revokedAt: null }, { expiresAt: { lte: cutoff } }] },
      ],
    },
  });
  return result.count;
}

export async function countOldNotificationsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<number> {
  return client.notification.count({ where: { createdAt: { lte: cutoff } } });
}

export async function deleteOldNotificationsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<number> {
  const result = await client.notification.deleteMany({ where: { createdAt: { lte: cutoff } } });
  return result.count;
}

/**
 * "Terminally failed" means attempt >= maxAttempts (permanently FAILED,
 * per job-state-machine.ts - a FAILED job with attempts remaining can still
 * transition back to PENDING and must never be purged out from under a
 * pending retry). Comparing two columns on the same row cannot be
 * expressed through Prisma's fluent API, so this uses parameterized raw
 * SQL - the same justified exception already documented for
 * countMaxAttemptsReachedJobs in analytics-repository.ts. Table names are
 * fixed literals; cutoff is the only bound parameter.
 */
export async function countTerminallyFailedJobsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<{ extractionJobs: number; segmentationJobs: number }> {
  const [extractionRows, segmentationRows] = await Promise.all([
    client.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM contract_extraction_jobs
        WHERE status = 'FAILED' AND attempt >= "maxAttempts" AND "updatedAt" <= ${cutoff}`
    ),
    client.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM clause_segmentation_jobs
        WHERE status = 'FAILED' AND attempt >= "maxAttempts" AND "updatedAt" <= ${cutoff}`
    ),
  ]);
  return {
    extractionJobs: Number(extractionRows[0]?.count ?? 0),
    segmentationJobs: Number(segmentationRows[0]?.count ?? 0),
  };
}

export async function deleteTerminallyFailedJobsForPurge(
  cutoff: Date,
  client: DbClient = prisma
): Promise<{ extractionJobs: number; segmentationJobs: number }> {
  const [extractionResult, segmentationResult] = await Promise.all([
    client.$executeRaw(
      Prisma.sql`DELETE FROM contract_extraction_jobs
        WHERE status = 'FAILED' AND attempt >= "maxAttempts" AND "updatedAt" <= ${cutoff}`
    ),
    client.$executeRaw(
      Prisma.sql`DELETE FROM clause_segmentation_jobs
        WHERE status = 'FAILED' AND attempt >= "maxAttempts" AND "updatedAt" <= ${cutoff}`
    ),
  ]);
  return { extractionJobs: extractionResult, segmentationJobs: segmentationResult };
}
