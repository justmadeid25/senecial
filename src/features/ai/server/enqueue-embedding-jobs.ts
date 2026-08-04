import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { findLatestEmbeddingForClause } from "@/server/repositories/clause-embedding-repository";
import { enqueueEmbeddingJob } from "@/server/repositories/embedding-job-repository";
import { prisma } from "@/server/db/client";

/**
 * §Embedding Pipeline - called right after a segmentation job creates new
 * ContractClause rows (see process-clause-segmentation-job.ts). Best-effort:
 * a failure here must never fail the segmentation job itself (a clause
 * that exists but has no embedding yet is still fully usable everywhere
 * except AI retrieval - the embedding worker will simply pick it up
 * whenever this next succeeds or the stale-scan below next runs), same
 * "never block on this" philosophy as this codebase's own audit-log
 * best-effort writes.
 */
export async function enqueueEmbeddingJobsForClauses(
  clauses: { id: string; organizationId: string; normalizedText: string }[]
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const clause of clauses) {
    const checksum = computeClauseTextChecksum(clause.normalizedText);
    const result = await enqueueEmbeddingJob({
      organizationId: clause.organizationId,
      contractClauseId: clause.id,
      inputChecksum: checksum,
    });
    if (result) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export interface StaleEmbeddingScanResult {
  scanned: number;
  enqueued: number;
}

/**
 * §Embedding Pipeline - "조항 수정 → embedding stale → queue 생성": scans
 * every clause (optionally scoped to one organization) whose current
 * normalizedText checksum does not match its latest ClauseEmbedding's
 * checksum (or has no embedding at all yet) and enqueues a job for each.
 * Idempotent - EmbeddingJob's `@@unique([contractClauseId,
 * inputChecksum])` means re-running this for an already-queued/-completed
 * checksum is a silent no-op, so this is safe to run on a schedule
 * (`pnpm ai:scan-stale-embeddings`) as well as on demand.
 */
export async function scanAndEnqueueStaleClauseEmbeddings(organizationId?: string): Promise<StaleEmbeddingScanResult> {
  const clauses = await prisma.contractClause.findMany({
    where: organizationId ? { organizationId } : {},
    select: { id: true, organizationId: true, normalizedText: true },
  });

  let enqueued = 0;
  for (const clause of clauses) {
    const currentChecksum = computeClauseTextChecksum(clause.normalizedText);
    const latest = await findLatestEmbeddingForClause(clause.id);
    if (latest && latest.checksum === currentChecksum) {
      continue; // already has a current embedding - not stale
    }

    const result = await enqueueEmbeddingJob({
      organizationId: clause.organizationId,
      contractClauseId: clause.id,
      inputChecksum: currentChecksum,
    });
    if (result) {
      enqueued += 1;
    }
  }

  return { scanned: clauses.length, enqueued };
}
