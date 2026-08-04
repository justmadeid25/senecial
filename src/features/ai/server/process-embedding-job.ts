import { EMBEDDING_ERROR_CODES } from "@/domain/ai/embedding-error-codes";
import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { createLatestClauseEmbedding } from "@/server/repositories/clause-embedding-repository";
import {
  claimNextPendingEmbeddingJob,
  updateEmbeddingJob,
  type EmbeddingJobRow,
} from "@/server/repositories/embedding-job-repository";
import { prisma } from "@/server/db/client";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { recordDependencyLatency } from "@/server/monitoring/metrics";

export interface ProcessNextEmbeddingJobResult {
  processed: boolean;
  jobId?: string;
}

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/process-embedding-jobs.ts), mirroring processNextExtractionJob()
 * exactly.
 */
export async function processNextEmbeddingJob(workerId: string): Promise<ProcessNextEmbeddingJobResult> {
  const job = await claimNextPendingEmbeddingJob(workerId);
  if (!job) {
    return { processed: false };
  }

  await runClaimedJob(job);
  return { processed: true, jobId: job.id };
}

async function failJob(jobId: string, errorCode: string, safeErrorMessage: string): Promise<void> {
  await updateEmbeddingJob({
    jobId,
    data: { status: "FAILED", failedAt: new Date(), errorCode, errorMessage: safeErrorMessage },
  });
}

async function runClaimedJob(job: EmbeddingJobRow): Promise<void> {
  const clause = await prisma.contractClause.findUnique({
    where: { id: job.contractClauseId },
    select: { normalizedText: true, organizationId: true },
  });

  if (!clause) {
    // The clause was deleted (e.g. contract deleted) between enqueue and
    // claim - not a provider/retry-worthy failure, just nothing left to do.
    await failJob(job.id, EMBEDDING_ERROR_CODES.CLAUSE_NOT_FOUND, "연결된 조항을 찾을 수 없습니다.");
    return;
  }

  try {
    // Re-verify against the CURRENT clause content, not just the checksum
    // captured at enqueue time (§21-style re-verification, same rationale
    // as extraction jobs' inputChecksum check) - if the clause changed
    // again since this job was enqueued, this always embeds the latest
    // text and records the checksum that actually matches it.
    const currentChecksum = computeClauseTextChecksum(clause.normalizedText);

    const provider = getEmbeddingProvider();
    const start = performance.now();
    const result = await provider.generateEmbedding(clause.normalizedText);
    recordDependencyLatency("embedding", performance.now() - start);

    await createLatestClauseEmbedding({
      organizationId: clause.organizationId,
      contractClauseId: job.contractClauseId,
      provider: provider.providerName,
      model: provider.modelName,
      dimension: result.dimension,
      vector: result.vector,
      checksum: currentChecksum,
    });

    await updateEmbeddingJob({
      jobId: job.id,
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        provider: provider.providerName,
        model: provider.modelName,
        lockedAt: null,
        lockedBy: null,
      },
    });
  } catch (error) {
    if (job.attempt >= job.maxAttempts) {
      await failJob(job.id, EMBEDDING_ERROR_CODES.MAX_ATTEMPTS_REACHED, "최대 재시도 횟수를 초과했습니다.");
      return;
    }
    // Retryable - leave it PENDING (with the incremented attempt count
    // already recorded by claimNextPendingEmbeddingJob) for the next
    // worker invocation to pick back up, same shape as the mail queue's
    // retryable-failure path.
    await updateEmbeddingJob({
      jobId: job.id,
      data: {
        status: "PENDING",
        errorCode: EMBEDDING_ERROR_CODES.PROVIDER_ERROR,
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : "알 수 없는 오류",
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
