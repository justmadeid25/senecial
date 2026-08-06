import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface RecordAiUsageData {
  organizationId: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  operationType: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  requestCount?: number;
  estimatedCostMinor?: bigint | null;
  currency?: string | null;
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
  fallbackUsed?: boolean;
  aiConfigVersion: string;
  aiConfigChecksum: string;
}

/**
 * §Phase 13 Part G (§22) - the ONLY write path for AiUsageRecord. Never
 * throws on the caller's behalf for a logging failure - see
 * recordAiUsageBestEffort() below, the path every AI request/embedding
 * job should actually call, since a usage-logging failure must never
 * block or fail the AI operation it is trying to record.
 */
export async function recordAiUsage(data: RecordAiUsageData, client: DbClient = prisma): Promise<void> {
  await client.aiUsageRecord.create({
    data: {
      organizationId: data.organizationId,
      userId: data.userId,
      conversationId: data.conversationId,
      messageId: data.messageId,
      operationType: data.operationType,
      provider: data.provider,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      embeddingTokens: data.embeddingTokens,
      requestCount: data.requestCount ?? 1,
      estimatedCostMinor: data.estimatedCostMinor ?? undefined,
      currency: data.currency ?? undefined,
      latencyMs: data.latencyMs,
      success: data.success,
      errorCode: data.errorCode ?? undefined,
      fallbackUsed: data.fallbackUsed ?? false,
      aiConfigVersion: data.aiConfigVersion,
      aiConfigChecksum: data.aiConfigChecksum,
    },
  });
}

export interface OrganizationUsagePeriodTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  /** Only ever the sum of rows with a known cost - null-cost rows are excluded, never treated as 0 (see pricing.ts). */
  estimatedCostMinor: bigint;
  failureCount: number;
  fallbackCount: number;
}

/**
 * §Phase 13 Part G (§27) - the read side of budget enforcement: how much
 * an organization has ALREADY consumed since `sinceDate`. Used both by
 * the settings screen and by the budget reservation check (which adds the
 * current request's own estimated cost/count on top before comparing
 * against Organization.monthlyAiBudgetMinor/monthlyAiRequestLimit).
 */
export async function getOrganizationUsageTotalsSince(
  organizationId: string,
  sinceDate: Date,
  client: DbClient = prisma
): Promise<OrganizationUsagePeriodTotals> {
  const aggregate = await client.aiUsageRecord.aggregate({
    where: { organizationId, createdAt: { gte: sinceDate } },
    _sum: { requestCount: true, inputTokens: true, outputTokens: true, embeddingTokens: true, estimatedCostMinor: true },
  });
  const failureCount = await client.aiUsageRecord.count({
    where: { organizationId, createdAt: { gte: sinceDate }, success: false },
  });
  const fallbackCount = await client.aiUsageRecord.count({
    where: { organizationId, createdAt: { gte: sinceDate }, fallbackUsed: true },
  });

  return {
    requestCount: aggregate._sum.requestCount ?? 0,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    embeddingTokens: aggregate._sum.embeddingTokens ?? 0,
    estimatedCostMinor: aggregate._sum.estimatedCostMinor ?? BigInt(0),
    failureCount,
    fallbackCount,
  };
}

export interface AiUsageFilter {
  organizationId: string;
  from?: Date;
  to?: Date;
  provider?: string;
  model?: string;
  operationType?: string;
  success?: boolean;
}

export interface AiUsageBreakdownRow {
  provider: string;
  model: string;
  currency: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  estimatedCostMinor: bigint;
  failureCount: number;
  fallbackCount: number;
  avgLatencyMs: number;
}

/**
 * §Phase 13 Part H (§25/§39) - the AI usage settings screen's own query.
 * Grouped by provider/model/currency (never mixing currencies in one sum
 * - §39's "통화 혼합이 있으면 합산하지 마십시오") - a currency mismatch
 * across pricing table versions would otherwise silently produce a
 * meaningless total.
 */
export async function getOrganizationUsageBreakdown(filter: AiUsageFilter, client: DbClient = prisma): Promise<AiUsageBreakdownRow[]> {
  const where: Prisma.AiUsageRecordWhereInput = {
    organizationId: filter.organizationId,
    ...(filter.from || filter.to ? { createdAt: { gte: filter.from, lte: filter.to } } : {}),
    ...(filter.provider ? { provider: filter.provider } : {}),
    ...(filter.model ? { model: filter.model } : {}),
    ...(filter.operationType ? { operationType: filter.operationType } : {}),
    ...(filter.success !== undefined ? { success: filter.success } : {}),
  };

  const grouped = await client.aiUsageRecord.groupBy({
    by: ["provider", "model", "currency"],
    where,
    _sum: { requestCount: true, inputTokens: true, outputTokens: true, embeddingTokens: true, estimatedCostMinor: true, latencyMs: true },
    _count: { _all: true },
  });

  const rows: AiUsageBreakdownRow[] = [];
  for (const group of grouped) {
    const failureCount = await client.aiUsageRecord.count({ where: { ...where, provider: group.provider, model: group.model, success: false } });
    const fallbackCount = await client.aiUsageRecord.count({
      where: { ...where, provider: group.provider, model: group.model, fallbackUsed: true },
    });
    rows.push({
      provider: group.provider,
      model: group.model,
      currency: group.currency,
      requestCount: group._sum.requestCount ?? 0,
      inputTokens: group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
      embeddingTokens: group._sum.embeddingTokens ?? 0,
      estimatedCostMinor: group._sum.estimatedCostMinor ?? BigInt(0),
      failureCount,
      fallbackCount,
      avgLatencyMs: group._count._all > 0 ? Math.round((group._sum.latencyMs ?? 0) / group._count._all) : 0,
    });
  }
  return rows;
}
