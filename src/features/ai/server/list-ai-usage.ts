import { MembershipRole } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { aiUsageListQuerySchema } from "@/lib/validation/ai-usage";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { prisma } from "@/server/db/client";
import {
  getOrganizationUsageBreakdown,
  getOrganizationUsageTotalsSince,
  type AiUsageBreakdownRow,
} from "@/server/repositories/ai-usage-repository";

export interface AiUsageCurrencyTotal {
  currency: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  estimatedCostMinor: bigint;
}

export interface AiUsageBudgetStatus {
  monthlyAiBudgetMinor: bigint | null;
  monthlyAiRequestLimit: number | null;
  dailyAiRequestLimit: number | null;
  /** Only meaningful when monthlyAiBudgetMinor is set - the fraction (0-1) of budget consumed so far this UTC calendar month. */
  monthlyBudgetUsageFraction: number | null;
  monthlyRequestUsageFraction: number | null;
}

export interface ListAiUsageResult {
  breakdown: AiUsageBreakdownRow[];
  /** §39 - "통화 혼합이 있으면 합산하지 마십시오" - one total PER currency, never a single cross-currency sum. */
  totalsByCurrency: AiUsageCurrencyTotal[];
  totalFailureCount: number;
  totalFallbackCount: number;
  budget: AiUsageBudgetStatus;
}

function startOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** OWNER only - see README's AI usage section, mirrors listAuditLogs()'s identical role-check shape. */
export async function listAiUsage(params: { userId: string; organizationId: string; query: unknown }): Promise<ListAiUsageResult> {
  const authContext = await verifyOrganizationRole(params.userId, params.organizationId, MembershipRole.OWNER);

  const parsed = aiUsageListQuerySchema.safeParse(params.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "검색 조건이 올바르지 않습니다.");
  }
  const { from, to, provider, model, operationType } = parsed.data;

  const breakdown = await getOrganizationUsageBreakdown({
    organizationId: authContext.organizationId,
    from,
    to,
    provider,
    model,
    operationType,
  });

  const byCurrency = new Map<string, AiUsageCurrencyTotal>();
  let totalFailureCount = 0;
  let totalFallbackCount = 0;
  for (const row of breakdown) {
    const key = row.currency ?? "(알 수 없음)";
    const entry = byCurrency.get(key) ?? {
      currency: key,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      estimatedCostMinor: BigInt(0),
    };
    entry.requestCount += row.requestCount;
    entry.inputTokens += row.inputTokens;
    entry.outputTokens += row.outputTokens;
    entry.embeddingTokens += row.embeddingTokens;
    entry.estimatedCostMinor += row.estimatedCostMinor;
    byCurrency.set(key, entry);
    totalFailureCount += row.failureCount;
    totalFallbackCount += row.fallbackCount;
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: authContext.organizationId },
    select: { monthlyAiBudgetMinor: true, monthlyAiRequestLimit: true, dailyAiRequestLimit: true },
  });
  const monthTotals = await getOrganizationUsageTotalsSince(authContext.organizationId, startOfCurrentUtcMonth());

  return {
    breakdown,
    totalsByCurrency: [...byCurrency.values()],
    totalFailureCount,
    totalFallbackCount,
    budget: {
      monthlyAiBudgetMinor: org.monthlyAiBudgetMinor,
      monthlyAiRequestLimit: org.monthlyAiRequestLimit,
      dailyAiRequestLimit: org.dailyAiRequestLimit,
      monthlyBudgetUsageFraction:
        org.monthlyAiBudgetMinor !== null && org.monthlyAiBudgetMinor > BigInt(0)
          ? Number(monthTotals.estimatedCostMinor) / Number(org.monthlyAiBudgetMinor)
          : null,
      monthlyRequestUsageFraction:
        org.monthlyAiRequestLimit !== null && org.monthlyAiRequestLimit > 0
          ? monthTotals.requestCount / org.monthlyAiRequestLimit
          : null,
    },
  };
}
