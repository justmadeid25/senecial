import { AI_USAGE_OPERATION_TYPES } from "@/domain/ai/ai-usage-operation";
import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { EMBEDDING_ERROR_CODES } from "@/domain/ai/embedding-error-codes";
import { AiDisabledError, ExternalAiProcessingDisabledError } from "@/domain/ai/external-ai-policy";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { prisma } from "@/server/db/client";
import { recordDependencyLatency } from "@/server/monitoring/metrics";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "@/server/services/ai/budget/reserve-ai-budget";
import { enforceOrganizationAiPolicy } from "@/server/services/ai/enforce-organization-ai-policy";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { recordAiUsageBestEffort } from "@/server/services/ai/record-ai-usage-best-effort";
import { createLatestClauseEmbedding } from "@/server/repositories/clause-embedding-repository";
import {
  claimNextPendingEmbeddingJob,
  updateEmbeddingJob,
  type EmbeddingJobRow,
} from "@/server/repositories/embedding-job-repository";

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

  const provider = getEmbeddingProvider();

  // §Phase 13 Part H (§30) - checked BEFORE any provider call, and BEFORE
  // the budget reservation below (an org with AI disabled has no business
  // reserving budget it will never spend). Not retry-worthy - see
  // EMBEDDING_ERROR_CODES.AI_POLICY_DISABLED's own docstring.
  try {
    await enforceOrganizationAiPolicy(clause.organizationId, provider.providerName);
  } catch (policyError) {
    if (policyError instanceof AiDisabledError || policyError instanceof ExternalAiProcessingDisabledError) {
      await failJob(job.id, EMBEDDING_ERROR_CODES.AI_POLICY_DISABLED, policyError.message);
      return;
    }
    throw policyError;
  }

  // §Phase 13 Part G (§27) - worst-case reservation sized off the clause
  // text's own length (already known, unlike an LLM completion's not-yet-
  // generated output) - embedding cost is a pure function of input length,
  // so there is no "worst-case output" uncertainty the way there is for
  // an LLM call.
  const estimatedTokens = Math.ceil(clause.normalizedText.length / 4);
  const costEstimate = estimateAiCostMinor({
    provider: provider.providerName,
    model: provider.modelName,
    embeddingTokens: estimatedTokens,
  });
  const budgetOutcome = await reserveAiBudget({
    organizationId: clause.organizationId,
    maxEstimatedCostMinor: costEstimate.estimatedCostMinor ?? BigInt(0),
  });
  if (!budgetOutcome.allowed) {
    await failJob(job.id, EMBEDDING_ERROR_CODES.BUDGET_EXCEEDED, "이번 조직의 AI 사용 한도에 도달했습니다.");
    return;
  }
  const reservation = budgetOutcome.reservation;

  const aiConfig = getAiRuntimeConfiguration();
  const jobStart = performance.now();

  try {
    // Re-verify against the CURRENT clause content, not just the checksum
    // captured at enqueue time (§21-style re-verification, same rationale
    // as extraction jobs' inputChecksum check) - if the clause changed
    // again since this job was enqueued, this always embeds the latest
    // text and records the checksum that actually matches it.
    const currentChecksum = computeClauseTextChecksum(clause.normalizedText);

    const start = performance.now();
    const result = await provider.generateEmbedding(clause.normalizedText);
    const durationMs = performance.now() - start;
    recordDependencyLatency("embedding", durationMs);

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

    const actualTokens = result.usage?.inputTokens ?? estimatedTokens;
    const actualCost = estimateAiCostMinor({
      provider: provider.providerName,
      model: provider.modelName,
      embeddingTokens: actualTokens,
    });
    await settleAiBudget(reservation, actualCost.estimatedCostMinor);
    await recordAiUsageBestEffort({
      organizationId: clause.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      embeddingTokens: actualTokens,
      estimatedCostMinor: actualCost.estimatedCostMinor,
      currency: actualCost.currency,
      latencyMs: Math.round(performance.now() - jobStart),
      success: true,
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });
  } catch (error) {
    await releaseAiBudget(reservation);
    await recordAiUsageBestEffort({
      organizationId: clause.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      latencyMs: Math.round(performance.now() - jobStart),
      success: false,
      errorCode: EMBEDDING_ERROR_CODES.PROVIDER_ERROR,
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });

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
