import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";
import { isRetryableSegmentationError, SEGMENTATION_ERROR_CODES } from "@/domain/clauses/segmentation-error-codes";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { CLAUSE_SEGMENTATION_STALE_MINUTES } from "@/lib/config/clause-segmentation";
import {
  findStaleProcessingClauseSegmentationJobs,
  resetClauseSegmentationJobToPending,
  updateClauseSegmentationJob,
} from "@/server/repositories/clause-segmentation-job-repository";
import { prisma } from "@/server/db/client";

export interface RecoverStaleClauseSegmentationJobsResult {
  scanned: number;
  recoveredToPending: number;
  failed: number;
}

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/recover-stale-clause-jobs.ts), same shape as Phase 6's
 * recoverStaleExtractionJobs().
 */
export async function recoverStaleClauseSegmentationJobs(
  staleMinutes: number = CLAUSE_SEGMENTATION_STALE_MINUTES
): Promise<RecoverStaleClauseSegmentationJobsResult> {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleJobs = await findStaleProcessingClauseSegmentationJobs(staleBefore);

  let recoveredToPending = 0;
  let failed = 0;

  for (const job of staleJobs) {
    if (isRetryableSegmentationError("", job.attempt, job.maxAttempts)) {
      await prisma.$transaction(async (tx) => {
        const reset = await resetClauseSegmentationJobToPending(job.id, tx);
        await tx.auditLog.create({
          data: {
            organizationId: reset.organizationId,
            userId: null,
            entityType: "ClauseSegmentationJob",
            entityId: reset.id,
            action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_RETRY_REQUESTED,
            metadata: { jobId: reset.id, contractId: reset.contractId, reason: "stale_recovery" },
          },
        });
      });
      recoveredToPending += 1;
    } else {
      await prisma.$transaction(async (tx) => {
        await updateClauseSegmentationJob(
          {
            jobId: job.id,
            data: {
              status: ClauseSegmentationJobStatus.FAILED,
              failedAt: new Date(),
              errorCode: SEGMENTATION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
              errorMessage: "정체된 작업을 복구하지 못했습니다 (최대 재시도 횟수 초과).",
              lockedAt: null,
              lockedBy: null,
            },
          },
          tx
        );
        await tx.auditLog.create({
          data: {
            organizationId: job.organizationId,
            userId: null,
            entityType: "ClauseSegmentationJob",
            entityId: job.id,
            action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_FAILED,
            metadata: {
              jobId: job.id,
              contractId: job.contractId,
              errorCode: SEGMENTATION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
            },
          },
        });
      });
      failed += 1;
    }
  }

  return { scanned: staleJobs.length, recoveredToPending, failed };
}
