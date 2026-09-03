import type { Citation } from "@/domain/ai/citation";
import { assertAnswerGrounded } from "@/domain/ai/citation-required";
import type { LlmMessage } from "@/domain/ai/llm-provider";
import { loadAiShadowConfig } from "@/lib/config/ai-shadow";
import { shouldSampleForShadow } from "@/domain/ai/shadow-sampling";
import { getLogger } from "@/server/logging";
import { recordShadowEvaluation } from "@/server/monitoring/metrics";
import { getShadowLlmProvider } from "@/server/services/ai/get-shadow-llm-provider";

/**
 * §Phase 13 Part F (§20) - fire-and-forget: called from
 * ask-question.ts's streaming path WITHOUT `await`, after the primary
 * answer has already been produced and sent to the user. Every failure
 * mode here (config check, provider error, citation-validation throw) is
 * caught internally and only ever recorded as a metric/log - this
 * function must NEVER be able to affect the primary request's outcome or
 * latency (the whole reason it's dispatched unawaited).
 *
 * Only structured, non-identifying signals are recorded (success,
 * citation-validity, latency) - the shadow provider's actual answer text
 * is never logged or persisted anywhere (§20's "원문 답변 전체 저장은
 * 피하고 구조화된 품질 지표를 우선").
 */
export function maybeDispatchShadowEvaluation(params: { organizationId: string; messages: LlmMessage[]; contextCitations: Citation[] }): void {
  const config = loadAiShadowConfig();
  if (!config.enabled || !shouldSampleForShadow(config.sampleRate)) {
    return;
  }

  const shadowProvider = getShadowLlmProvider();
  if (!shadowProvider) {
    return;
  }

  void runShadowComparison(shadowProvider, params).catch((error: unknown) => {
    getLogger().warn("ai_shadow.dispatch_failed", {
      organizationId: params.organizationId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    });
  });
}

async function runShadowComparison(
  shadowProvider: NonNullable<ReturnType<typeof getShadowLlmProvider>>,
  params: { organizationId: string; messages: LlmMessage[]; contextCitations: Citation[] }
): Promise<void> {
  const start = performance.now();
  try {
    const result = await shadowProvider.generateCompletion(params.messages);
    const latencyMs = Math.round(performance.now() - start);

    // §AI 답변 품질 개편 P0-4 - the shadow provider receives the SAME
    // `messages` the primary answer used (params.messages, built by
    // buildPromptMessages()), so its own completion follows the same
    // tagged-block prompt format - the block-aware validator (not the
    // strict per-paragraph one, which would misreport a valid
    // 결론/확인사항 block as invalid) is the correct check here.
    let citationValid = true;
    try {
      assertAnswerGrounded(result.text, params.contextCitations);
    } catch {
      citationValid = false;
    }

    recordShadowEvaluation({ success: true, citationValid, latencyMs });
    getLogger().info("ai_shadow.evaluation_completed", {
      organizationId: params.organizationId,
      shadowProvider: shadowProvider.providerName,
      shadowModel: shadowProvider.modelName,
      citationValid,
      latencyMs,
      answerLength: result.text.length,
    });
  } catch (error) {
    recordShadowEvaluation({ success: false });
    getLogger().warn("ai_shadow.evaluation_failed", {
      organizationId: params.organizationId,
      shadowProvider: shadowProvider.providerName,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}
