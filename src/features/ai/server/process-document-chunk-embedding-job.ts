import { AI_USAGE_OPERATION_TYPES } from "@/domain/ai/ai-usage-operation";
import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { CHUNK_EMBEDDING_ERROR_CODES } from "@/domain/ai/chunk-embedding-error-codes";
import { AiDisabledError, ExternalAiProcessingDisabledError } from "@/domain/ai/external-ai-policy";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { prisma } from "@/server/db/client";
import { recordDependencyLatency, recordEmbeddingTokenUsage } from "@/server/monitoring/metrics";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "@/server/services/ai/budget/reserve-ai-budget";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";
import { getEmbeddingProviderForOrganization } from "@/server/services/ai/get-embedding-provider-for-organization";
import { loadOrganizationAiContext } from "@/server/services/ai/load-organization-ai-context";
import { recordAiUsageBestEffort } from "@/server/services/ai/record-ai-usage-best-effort";
import { createLatestChunkEmbedding } from "@/server/repositories/contract-document-chunk-embedding-repository";
import {
  claimNextPendingChunkEmbeddingJob,
  updateChunkEmbeddingJob,
  type ChunkEmbeddingJobRow,
} from "@/server/repositories/contract-document-chunk-embedding-job-repository";

export interface ProcessNextChunkEmbeddingJobResult {
  processed: boolean;
  jobId?: string;
}

/**
 * §Phase 14.1 - mirrors processNextEmbeddingJob() (process-embedding-job.ts)
 * exactly, for ContractDocumentChunk instead of ContractClause: same
 * provider routing, budget reservation/settlement, usage accounting, and
 * retry/max-attempts shape, reusing every shared AI-provider/budget
 * service as-is. No auth check by design - trusted CLI-only entry point
 * (scripts/process-document-chunk-embedding-jobs.ts).
 */
export async function processNextChunkEmbeddingJob(workerId: string): Promise<ProcessNextChunkEmbeddingJobResult> {
  const job = await claimNextPendingChunkEmbeddingJob(workerId);
  if (!job) {
    return { processed: false };
  }

  await runClaimedJob(job);
  return { processed: true, jobId: job.id };
}

async function failJob(jobId: string, errorCode: string, safeErrorMessage: string): Promise<void> {
  await updateChunkEmbeddingJob({
    jobId,
    data: { status: "FAILED", failedAt: new Date(), errorCode, errorMessage: safeErrorMessage },
  });
}

async function runClaimedJob(job: ChunkEmbeddingJobRow): Promise<void> {
  const chunk = await prisma.contractDocumentChunk.findUnique({
    where: { id: job.chunkId },
    select: { normalizedText: true, organizationId: true },
  });

  if (!chunk) {
    // The chunk was deleted (e.g. contract deleted, or re-chunked) between
    // enqueue and claim - not a provider/retry-worthy failure.
    await failJob(job.id, CHUNK_EMBEDDING_ERROR_CODES.CHUNK_NOT_FOUND, "연결된 문서 청크를 찾을 수 없습니다.");
    return;
  }

  let provider;
  let group: "primary" | "canary";
  try {
    const aiContext = await loadOrganizationAiContext(chunk.organizationId);
    const selection = getEmbeddingProviderForOrganization({ organizationId: chunk.organizationId, ...aiContext });
    provider = selection.provider;
    group = selection.group;
  } catch (policyError) {
    if (policyError instanceof AiDisabledError || policyError instanceof ExternalAiProcessingDisabledError) {
      await failJob(job.id, CHUNK_EMBEDDING_ERROR_CODES.AI_POLICY_DISABLED, policyError.message);
      return;
    }
    throw policyError;
  }

  const estimatedTokens = Math.ceil(chunk.normalizedText.length / 4);
  const costEstimate = estimateAiCostMinor({
    provider: provider.providerName,
    model: provider.modelName,
    embeddingTokens: estimatedTokens,
  });
  const budgetOutcome = await reserveAiBudget({
    organizationId: chunk.organizationId,
    maxEstimatedCostMinor: costEstimate.estimatedCostMinor ?? BigInt(0),
  });
  if (!budgetOutcome.allowed) {
    await failJob(job.id, CHUNK_EMBEDDING_ERROR_CODES.BUDGET_EXCEEDED, "이번 조직의 AI 사용 한도에 도달했습니다.");
    return;
  }
  const reservation = budgetOutcome.reservation;

  const aiConfig = getAiRuntimeConfiguration({ embeddingProvider: provider });
  const jobStart = performance.now();

  try {
    const currentChecksum = computeClauseTextChecksum(chunk.normalizedText);

    const start = performance.now();
    const result = await provider.generateEmbedding(chunk.normalizedText);
    const durationMs = performance.now() - start;
    recordDependencyLatency("embedding", durationMs);
    if (result.usage?.inputTokens !== undefined) {
      recordEmbeddingTokenUsage(result.usage.inputTokens);
    }

    await createLatestChunkEmbedding({
      organizationId: chunk.organizationId,
      chunkId: job.chunkId,
      provider: provider.providerName,
      model: provider.modelName,
      dimension: result.dimension,
      vector: result.vector,
      checksum: currentChecksum,
    });

    await updateChunkEmbeddingJob({
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
      organizationId: chunk.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      embeddingTokens: actualTokens,
      estimatedCostMinor: actualCost.estimatedCostMinor,
      currency: actualCost.currency,
      latencyMs: Math.round(performance.now() - jobStart),
      success: true,
      canaryUsed: group === "canary",
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });
  } catch (error) {
    await releaseAiBudget(reservation);
    await recordAiUsageBestEffort({
      organizationId: chunk.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      latencyMs: Math.round(performance.now() - jobStart),
      success: false,
      errorCode: CHUNK_EMBEDDING_ERROR_CODES.PROVIDER_ERROR,
      canaryUsed: group === "canary",
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });

    if (job.attempt >= job.maxAttempts) {
      await failJob(job.id, CHUNK_EMBEDDING_ERROR_CODES.MAX_ATTEMPTS_REACHED, "최대 재시도 횟수를 초과했습니다.");
      return;
    }
    await updateChunkEmbeddingJob({
      jobId: job.id,
      data: {
        status: "PENDING",
        errorCode: CHUNK_EMBEDDING_ERROR_CODES.PROVIDER_ERROR,
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : "알 수 없는 오류",
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
