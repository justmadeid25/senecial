import { EMBEDDING_ERROR_CODES } from "@/domain/ai/embedding-error-codes";
import {
  findStaleProcessingEmbeddingJobs,
  resetEmbeddingJobToPending,
  updateEmbeddingJob,
} from "@/server/repositories/embedding-job-repository";

const DEFAULT_STALE_MINUTES = 15;

export interface RecoverStaleEmbeddingJobsResult {
  scanned: number;
  recoveredToPending: number;
  failed: number;
}

/** Same "PROCESSING past the stale threshold = lost worker" recovery shape as recoverStaleExtractionJobs()/recoverStaleMailDeliveries(). */
export async function recoverStaleEmbeddingJobs(
  staleMinutes: number = DEFAULT_STALE_MINUTES
): Promise<RecoverStaleEmbeddingJobsResult> {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleJobs = await findStaleProcessingEmbeddingJobs(staleBefore);

  let recoveredToPending = 0;
  let failed = 0;

  for (const job of staleJobs) {
    if (job.attempt < job.maxAttempts) {
      await resetEmbeddingJobToPending(job.id);
      recoveredToPending += 1;
    } else {
      await updateEmbeddingJob({
        jobId: job.id,
        data: {
          status: "FAILED",
          failedAt: new Date(),
          errorCode: EMBEDDING_ERROR_CODES.MAX_ATTEMPTS_REACHED,
          errorMessage: "정체된 임베딩 작업을 복구하지 못했습니다 (최대 재시도 횟수 초과).",
          lockedAt: null,
          lockedBy: null,
        },
      });
      failed += 1;
    }
  }

  return { scanned: staleJobs.length, recoveredToPending, failed };
}
