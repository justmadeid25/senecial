import { AI_USAGE_OPERATION_TYPES } from "@/domain/ai/ai-usage-operation";
import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { assertOrganizationAiPolicy } from "@/domain/ai/external-ai-policy";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { prisma } from "@/server/db/client";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { recordAiUsageBestEffort } from "@/server/services/ai/record-ai-usage-best-effort";
import { createLatestClauseEmbedding } from "@/server/repositories/clause-embedding-repository";
import {
  countEmbeddingBackfillCandidates,
  findEmbeddingBackfillCandidates,
  type EmbeddingBackfillCandidate,
} from "@/server/repositories/embedding-backfill-candidate-repository";

/** chars/4 - the same rough heuristic used throughout this codebase (ask-question.ts's streaming fallback, budget reservation's worst-case sizing) when an exact provider-reported count isn't available yet. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface EmbeddingBackfillDryRunResult {
  provider: string;
  model: string;
  candidateCountInScope: number;
  candidateCountThisRun: number;
  estimatedTokens: number;
  estimatedCostMinor: bigint | null;
  pricingVersion: string;
}

/** §Phase 13 Part C (§10) - "실행 전에 대상 row 수와 예상 token 수, 예상 비용을 출력" - no writes, no provider calls. */
export async function dryRunEmbeddingBackfill(params: { limit: number; organizationId?: string }): Promise<EmbeddingBackfillDryRunResult> {
  const provider = getEmbeddingProvider();
  const candidateCountInScope = await countEmbeddingBackfillCandidates({
    targetProvider: provider.providerName,
    targetModel: provider.modelName,
    organizationId: params.organizationId,
  });
  const candidates = await findEmbeddingBackfillCandidates({
    targetProvider: provider.providerName,
    targetModel: provider.modelName,
    limit: params.limit,
    organizationId: params.organizationId,
  });
  const estimatedTokens = candidates.reduce((sum, c) => sum + estimateTokens(c.normalizedText), 0);
  const cost = estimateAiCostMinor({ provider: provider.providerName, model: provider.modelName, embeddingTokens: estimatedTokens });

  return {
    provider: provider.providerName,
    model: provider.modelName,
    candidateCountInScope,
    candidateCountThisRun: candidates.length,
    estimatedTokens,
    estimatedCostMinor: cost.estimatedCostMinor,
    pricingVersion: cost.pricingVersion,
  };
}

export interface EmbeddingBackfillFailure {
  contractClauseId: string;
  reason: string;
}

export interface EmbeddingBackfillResult {
  provider: string;
  model: string;
  candidateCountThisRun: number;
  processed: number;
  succeeded: number;
  skippedByPolicy: number;
  failed: EmbeddingBackfillFailure[];
}

const BATCH_SIZE_WHEN_SUPPORTED = 32;

async function embedOneCandidate(
  candidate: EmbeddingBackfillCandidate,
  provider: ReturnType<typeof getEmbeddingProvider>,
  aiConfig: ReturnType<typeof getAiRuntimeConfiguration>
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const start = performance.now();
  try {
    const result = await provider.generateEmbedding(candidate.normalizedText);
    await createLatestClauseEmbedding({
      organizationId: candidate.organizationId,
      contractClauseId: candidate.contractClauseId,
      provider: provider.providerName,
      model: provider.modelName,
      dimension: result.dimension,
      vector: result.vector,
      checksum: computeClauseTextChecksum(candidate.normalizedText),
    });
    const tokens = result.usage?.inputTokens ?? estimateTokens(candidate.normalizedText);
    const cost = estimateAiCostMinor({ provider: provider.providerName, model: provider.modelName, embeddingTokens: tokens });
    await recordAiUsageBestEffort({
      organizationId: candidate.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      embeddingTokens: tokens,
      estimatedCostMinor: cost.estimatedCostMinor,
      currency: cost.currency,
      latencyMs: Math.round(performance.now() - start),
      success: true,
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });
    return { ok: true };
  } catch (error) {
    await recordAiUsageBestEffort({
      organizationId: candidate.organizationId,
      operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
      provider: provider.providerName,
      model: provider.modelName,
      latencyMs: Math.round(performance.now() - start),
      success: false,
      errorCode: "PROVIDER_ERROR",
      aiConfigVersion: aiConfig.version,
      aiConfigChecksum: aiConfig.checksum,
    });
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : "알 수 없는 오류" };
  }
}

/**
 * §Phase 13 Part C (§7/§9/§10) - `pnpm ai:embedding-backfill --execute`.
 * Generates NEW production-provider embeddings for clauses whose current
 * `isLatest` embedding is still on a different provider/model (dual
 * embedding rollout - see docs/operations/ai-platform.md). Every clause is
 * its own independently-committed operation (createLatestClauseEmbedding()
 * is itself transactional per-row) - one clause's provider error is
 * collected in `failed` and never aborts the rest of the run (§7's "한
 * row의 오류로 전체 queue가 영구 실패하지 않게 하십시오"). Uses the
 * provider's batch endpoint when available (falling back to per-item calls
 * for that batch if the batch call itself fails, so one malformed item in
 * a batch never loses the whole batch), else calls generateEmbedding()
 * one clause at a time.
 */
export async function runEmbeddingBackfill(params: { limit: number; organizationId?: string }): Promise<EmbeddingBackfillResult> {
  const provider = getEmbeddingProvider();
  const aiConfig = getAiRuntimeConfiguration();
  const candidates = await findEmbeddingBackfillCandidates({
    targetProvider: provider.providerName,
    targetModel: provider.modelName,
    limit: params.limit,
    organizationId: params.organizationId,
  });

  const result: EmbeddingBackfillResult = {
    provider: provider.providerName,
    model: provider.modelName,
    candidateCountThisRun: candidates.length,
    processed: 0,
    succeeded: 0,
    skippedByPolicy: 0,
    failed: [],
  };

  // §Phase 13 Part H (§30) - group by organization so each org's policy is
  // checked exactly once per run (not once per clause), then every clause
  // belonging to a policy-disabled org is skipped without ever calling the
  // provider for it.
  const orgIds = [...new Set(candidates.map((c) => c.organizationId))];
  const allowedOrgIds = new Set<string>();
  for (const organizationId of orgIds) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { aiEnabled: true, allowExternalAiProcessing: true },
    });
    try {
      assertOrganizationAiPolicy(org, provider.providerName);
      allowedOrgIds.add(organizationId);
    } catch {
      // Left out of allowedOrgIds - every clause for this org is counted as skippedByPolicy below.
    }
  }

  const eligible = candidates.filter((c) => allowedOrgIds.has(c.organizationId));
  result.skippedByPolicy = candidates.length - eligible.length;

  for (let i = 0; i < eligible.length; i += BATCH_SIZE_WHEN_SUPPORTED) {
    const batch = eligible.slice(i, i + BATCH_SIZE_WHEN_SUPPORTED);

    if (provider.generateEmbeddings && batch.length > 1) {
      try {
        const batchResult = await provider.generateEmbeddings(batch.map((c) => c.normalizedText));
        // §7 - response ordering is verified via each item's own `index`, never assumed to match request order.
        const byIndex = new Map(batchResult.results.map((item) => [item.index, item]));
        for (let idx = 0; idx < batch.length; idx++) {
          const candidate = batch[idx]!;
          const item = byIndex.get(idx);
          result.processed += 1;
          if (!item) {
            result.failed.push({ contractClauseId: candidate.contractClauseId, reason: "배치 응답에 해당 항목이 없습니다." });
            continue;
          }
          try {
            await createLatestClauseEmbedding({
              organizationId: candidate.organizationId,
              contractClauseId: candidate.contractClauseId,
              provider: provider.providerName,
              model: provider.modelName,
              dimension: item.dimension,
              vector: item.vector,
              checksum: computeClauseTextChecksum(candidate.normalizedText),
            });
            const cost = estimateAiCostMinor({
              provider: provider.providerName,
              model: provider.modelName,
              embeddingTokens: item.usage?.inputTokens ?? estimateTokens(candidate.normalizedText),
            });
            await recordAiUsageBestEffort({
              organizationId: candidate.organizationId,
              operationType: AI_USAGE_OPERATION_TYPES.EMBEDDING,
              provider: provider.providerName,
              model: provider.modelName,
              embeddingTokens: item.usage?.inputTokens ?? estimateTokens(candidate.normalizedText),
              estimatedCostMinor: cost.estimatedCostMinor,
              currency: cost.currency,
              latencyMs: 0,
              success: true,
              aiConfigVersion: aiConfig.version,
              aiConfigChecksum: aiConfig.checksum,
            });
            result.succeeded += 1;
          } catch (writeError) {
            result.failed.push({
              contractClauseId: candidate.contractClauseId,
              reason: writeError instanceof Error ? writeError.message.slice(0, 200) : "알 수 없는 오류",
            });
          }
        }
        continue;
      } catch {
        // The whole batch call failed (e.g. rate limit, one malformed
        // item) - fall through to per-item processing for this batch
        // instead of losing every clause in it.
      }
    }

    for (const candidate of batch) {
      result.processed += 1;
      const outcome = await embedOneCandidate(candidate, provider, aiConfig);
      if (outcome.ok) {
        result.succeeded += 1;
      } else {
        result.failed.push({ contractClauseId: candidate.contractClauseId, reason: outcome.reason });
      }
    }
  }

  return result;
}
