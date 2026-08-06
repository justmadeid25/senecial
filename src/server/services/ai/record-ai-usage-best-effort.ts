import { getLogger } from "@/server/logging";
import { recordEstimatedCostMinor } from "@/server/monitoring/metrics";
import { recordAiUsage, type RecordAiUsageData } from "@/server/repositories/ai-usage-repository";

/**
 * §Phase 13 Part G (§22) - the call site every AI operation (ask-question,
 * embedding worker) should actually use: a usage-logging FAILURE must
 * never fail or block the AI operation it is trying to record (the user
 * already has their answer/embedding - losing one billing row is far
 * preferable to losing the response, or worse, retrying a real paid
 * provider call solely because the local DB write failed). Errors are
 * logged (error CODE only, via the DB error's constructor name - never
 * the raw driver message, which can echo bound values) and swallowed.
 */
export async function recordAiUsageBestEffort(data: RecordAiUsageData): Promise<void> {
  try {
    await recordAiUsage(data);
    if (data.estimatedCostMinor) {
      recordEstimatedCostMinor(data.estimatedCostMinor);
    }
  } catch (error) {
    getLogger().error("ai_usage.record_failed", {
      organizationId: data.organizationId,
      operationType: data.operationType,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}
