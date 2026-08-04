import { ExtractionJobStatus } from "@/generated/prisma/enums";
import { EXTRACTION_ERROR_CODES, isRetryableExtractionError } from "@/domain/extraction/extraction-error-codes";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { EXTRACTION_STALE_MINUTES } from "@/lib/config/extraction";
import {
  findStaleProcessingJobs,
  resetExtractionJobToPending,
  updateExtractionJob,
} from "@/server/repositories/extraction-job-repository";
import { prisma } from "@/server/db/client";

export interface RecoverStaleExtractionJobsResult {
  scanned: number;
  recoveredToPending: number;
  failed: number;
}

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/recover-stale-extraction-jobs.ts), like every other batch
 * service in this codebase (notifications, file reconciliation, the
 * extraction worker itself).
 *
 * A PROCESSING job whose lock has been held past the stale threshold is
 * presumed to have lost its worker mid-run. If it still has retry budget
 * left it goes back to PENDING for another worker to pick up; otherwise it
 * is marked FAILED with MAX_ATTEMPTS_REACHED rather than staying stuck
 * PROCESSING forever.
 */
export async function recoverStaleExtractionJobs(
  staleMinutes: number = EXTRACTION_STALE_MINUTES
): Promise<RecoverStaleExtractionJobsResult> {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleJobs = await findStaleProcessingJobs(staleBefore);

  let recoveredToPending = 0;
  let failed = 0;

  for (const job of staleJobs) {
    if (isRetryableExtractionError("", job.attempt, job.maxAttempts)) {
      await prisma.$transaction(async (tx) => {
        const reset = await resetExtractionJobToPending(job.id, tx);
        await tx.auditLog.create({
          data: {
            organizationId: reset.organizationId,
            userId: null,
            entityType: "ContractExtractionJob",
            entityId: reset.id,
            action: AUDIT_ACTIONS.EXTRACTION_RETRY_REQUESTED,
            metadata: { jobId: reset.id, contractId: reset.contractId, reason: "stale_recovery" },
          },
        });
      });
      recoveredToPending += 1;
    } else {
      await prisma.$transaction(async (tx) => {
        await updateExtractionJob(
          {
            jobId: job.id,
            data: {
              status: ExtractionJobStatus.FAILED,
              failedAt: new Date(),
              errorCode: EXTRACTION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
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
            entityType: "ContractExtractionJob",
            entityId: job.id,
            action: AUDIT_ACTIONS.EXTRACTION_JOB_FAILED,
            metadata: {
              jobId: job.id,
              contractId: job.contractId,
              errorCode: EXTRACTION_ERROR_CODES.MAX_ATTEMPTS_REACHED,
            },
          },
        });
      });
      failed += 1;
    }
  }

  return { scanned: staleJobs.length, recoveredToPending, failed };
}
