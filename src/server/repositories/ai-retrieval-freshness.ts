import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

/**
 * §Phase 14.2 - "latest authoritative revision only" for the AI retrieval
 * pipeline specifically. A SMALL, per-feature copy - NOT a shared import
 * from analytics-repository.ts's `latestReadySegmentationJobIdsForOrganization()`,
 * which dedupes "latest job PER EXTRACTED DOCUMENT" (solving job-retry
 * staleness within one document), not "latest PER CONTRACT" (the problem
 * here: a contract re-uploaded/re-extracted gets a genuinely NEW
 * ContractExtractedDocument, and that helper's own dedup key lets BOTH the
 * old and new document's clauses stay simultaneously "eligible" - verified
 * empirically: hybridSearchClauses() returned a stale V1 clause alongside
 * a real V2 clause for the identical contract before this fix existed).
 * Mirrors this codebase's own established "small per-feature copy over a
 * premature shared abstraction" convention (see that function's own
 * docstring) rather than modifying the shared analytics helper, whose
 * broader blast radius (contract type/knowledge-summary analytics, clause
 * search) is out of Phase 14.2's scope.
 *
 * §Chunk vs Clause alignment (§16) - both helpers below independently
 * answer "latest SUCCESSFULLY-PROCESSED revision for THIS artifact type,
 * per live contract":
 *  - chunks: the single latest ContractExtractedDocument per contract
 *    (extraction succeeding is itself the only precondition for a
 *    document - and therefore its chunks - existing at all; a FAILED
 *    extraction never creates one, so "latest document" already means
 *    "latest successful extraction" with no separate status check needed).
 *  - clauses: the single latest READY (REVIEW_REQUIRED/COMPLETED)
 *    ClauseSegmentationJob per contract. This can legitimately reference
 *    an OLDER extractedDocumentId than the chunk leg's answer, for a
 *    real, safe reason: if the newest document's segmentation is still
 *    pending or has failed, the clause leg falls back to the last
 *    document that WAS successfully segmented, rather than going empty -
 *    the same "extraction/processing failure != AI knowledge failure"
 *    principle from Phase 14.1, extended to segmentation lag. This is not
 *    "misalignment" in a harmful sense; it is safe eventual consistency.
 */

/** Live (non-soft-deleted) contract ids for an organization - shared by both helpers below. */
async function liveContractIds(organizationId: string): Promise<Set<string>> {
  const contracts = await prisma.contract.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true },
  });
  return new Set(contracts.map((c) => c.id));
}

/**
 * §Chunk leg - one ContractExtractedDocument id per live contract (the
 * most recently created one). Chunk queries filter to
 * `extractedDocumentId IN (this set)` at the SQL/query level - never as
 * an in-application post-filter (§4/§17).
 */
export async function latestAuthoritativeExtractedDocumentIdsForOrganization(
  organizationId: string
): Promise<string[]> {
  const live = await liveContractIds(organizationId);
  if (live.size === 0) {
    return [];
  }

  const documents = await prisma.contractExtractedDocument.findMany({
    where: { organizationId, contractId: { in: [...live] } },
    select: { id: true, contractId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const latestByContract = new Map<string, string>();
  for (const document of documents) {
    if (!latestByContract.has(document.contractId)) {
      latestByContract.set(document.contractId, document.id);
    }
  }
  return [...latestByContract.values()];
}

/**
 * §Clause leg - one ClauseSegmentationJob id per live contract (the most
 * recently completed READY job). Clause queries filter to
 * `segmentationJobId IN (this set)` (or, equivalently, join through to
 * this job id set) at the SQL/query level.
 */
export async function latestAuthoritativeClauseSegmentationJobIdsForOrganization(
  organizationId: string
): Promise<string[]> {
  const live = await liveContractIds(organizationId);
  if (live.size === 0) {
    return [];
  }

  const jobs = await prisma.clauseSegmentationJob.findMany({
    where: {
      organizationId,
      contractId: { in: [...live] },
      status: { in: [ClauseSegmentationJobStatus.REVIEW_REQUIRED, ClauseSegmentationJobStatus.COMPLETED] },
    },
    select: { id: true, contractId: true, completedAt: true, createdAt: true },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });

  const latestByContract = new Map<string, string>();
  for (const job of jobs) {
    if (!latestByContract.has(job.contractId)) {
      latestByContract.set(job.contractId, job.id);
    }
  }
  return [...latestByContract.values()];
}
