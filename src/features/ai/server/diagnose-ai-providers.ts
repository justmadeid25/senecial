import type { CircuitState } from "@/domain/ai/circuit-breaker";
import { normalizeProviderError } from "@/domain/ai/provider-error";
import { getAiCircuitBreaker } from "@/server/services/ai/circuit-breaker/get-ai-circuit-breaker";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";

/**
 * §Phase 13 Part J (§37) - `pnpm ai:provider-diagnose`. Never uses real
 * contract data - this fixed, non-sensitive Korean sentence is the ONLY
 * text ever sent to a real provider by this diagnostic.
 */
const DIAGNOSTIC_PROBE_TEXT = "이것은 AI 공급자 진단용 테스트 문장입니다. 실제 계약 내용이 아닙니다.";

export interface EmbeddingDiagnoseResult {
  configured: boolean;
  providerName?: string;
  modelName?: string;
  dimension?: number;
  configError?: string;
  probe?: { ok: boolean; latencyMs?: number; inputTokens?: number; dimensionMatches?: boolean; errorCode?: string };
}

export interface LlmDiagnoseResult {
  configured: boolean;
  providerName?: string;
  modelName?: string;
  configError?: string;
  completionProbe?: {
    ok: boolean;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    /** Opaque, safe-length id only (never a full request/response echo) - §15's "provider request ID는 안전한 길이와 문자만 허용해 저장할 수 있습니다". */
    providerRequestId?: string;
    errorCode?: string;
  };
  streamingProbe?: {
    ok: boolean;
    chunkCount?: number;
    receivedUsageEvent?: boolean;
    receivedProviderRequestId?: boolean;
    providerRequestId?: string;
    /** Wall-clock time from stream() call to the FIRST text-delta event - not tracked anywhere else in this codebase (the golden evaluation uses non-streaming askQuestion()), so this diagnostic probe is the only real source of this number. */
    firstTokenLatencyMs?: number;
    totalLatencyMs?: number;
    errorCode?: string;
  };
  /** §Phase 13.1 (real-provider verification) - a SEPARATE, deliberately-aborted stream call, never sharing state with streamingProbe above. Aborts as soon as the first text-delta arrives (same bounded pattern as tests/integration/openai-provider-real.test.ts's own abort test) - never lets an open-ended prompt run to completion. */
  abortProbe?: { ok: boolean; abortHonoredAsError: boolean; receivedAnyDeltaBeforeAbort: boolean; errorCode?: string };
}

export interface AiProviderDiagnoseResult {
  executed: boolean;
  embedding: EmbeddingDiagnoseResult;
  llm: LlmDiagnoseResult;
  circuitBreakerStates: { embedding?: CircuitState; llm?: CircuitState };
}

async function diagnoseEmbedding(execute: boolean): Promise<EmbeddingDiagnoseResult> {
  let provider;
  try {
    provider = getEmbeddingProvider();
  } catch (error) {
    return { configured: false, configError: error instanceof Error ? error.message : "알 수 없는 오류" };
  }

  const base: EmbeddingDiagnoseResult = {
    configured: true,
    providerName: provider.providerName,
    modelName: provider.modelName,
    dimension: provider.dimension,
  };
  if (!execute) {
    return base;
  }

  const start = performance.now();
  try {
    const result = await provider.generateEmbedding(DIAGNOSTIC_PROBE_TEXT);
    return {
      ...base,
      probe: {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        inputTokens: result.usage?.inputTokens,
        dimensionMatches: result.vector.length === provider.dimension,
      },
    };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    return { ...base, probe: { ok: false, latencyMs: Math.round(performance.now() - start), errorCode: normalized.errorCode } };
  }
}

async function diagnoseLlm(execute: boolean): Promise<LlmDiagnoseResult> {
  let provider;
  try {
    provider = getLlmProvider();
  } catch (error) {
    return { configured: false, configError: error instanceof Error ? error.message : "알 수 없는 오류" };
  }

  const base: LlmDiagnoseResult = { configured: true, providerName: provider.providerName, modelName: provider.modelName };
  if (!execute) {
    return base;
  }

  const messages = [
    { role: "system" as const, content: "당신은 진단 테스트에 응답하는 보조자입니다. 정확히 'ok'라고만 답하십시오." },
    { role: "user" as const, content: DIAGNOSTIC_PROBE_TEXT },
  ];

  const completionStart = performance.now();
  let completionProbe: LlmDiagnoseResult["completionProbe"];
  try {
    const result = await provider.generateCompletion(messages);
    completionProbe = {
      ok: true,
      latencyMs: Math.round(performance.now() - completionStart),
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      providerRequestId: result.providerRequestId,
    };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    completionProbe = { ok: false, latencyMs: Math.round(performance.now() - completionStart), errorCode: normalized.errorCode };
  }

  let streamingProbe: LlmDiagnoseResult["streamingProbe"];
  try {
    const streamStart = performance.now();
    let firstTokenLatencyMs: number | undefined;
    let chunkCount = 0;
    let receivedUsageEvent = false;
    let receivedProviderRequestId = false;
    let providerRequestId: string | undefined;
    for await (const event of provider.stream(messages)) {
      if (event.type === "text-delta") {
        chunkCount += 1;
        if (firstTokenLatencyMs === undefined) {
          firstTokenLatencyMs = Math.round(performance.now() - streamStart);
        }
      }
      if (event.type === "usage") receivedUsageEvent = true;
      if (event.type === "provider-request-id") {
        receivedProviderRequestId = true;
        providerRequestId = event.value;
      }
    }
    streamingProbe = {
      ok: true,
      chunkCount,
      receivedUsageEvent,
      receivedProviderRequestId,
      providerRequestId,
      firstTokenLatencyMs,
      totalLatencyMs: Math.round(performance.now() - streamStart),
    };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    streamingProbe = { ok: false, errorCode: normalized.errorCode };
  }

  // §Phase 13.1 (real-provider verification) - abort propagation probe:
  // deliberately open-ended prompt, aborted on the FIRST text-delta (never
  // lets generation run further) - verifies the abort actually terminates
  // the stream (rejects) rather than silently completing.
  let abortProbe: LlmDiagnoseResult["abortProbe"];
  try {
    const controller = new AbortController();
    let receivedAnyDeltaBeforeAbort = false;
    let abortHonoredAsError = false;
    try {
      for await (const event of provider.stream(
        [
          { role: "system" as const, content: "숫자를 1부터 20까지 한 줄에 하나씩 답하십시오." },
          { role: "user" as const, content: DIAGNOSTIC_PROBE_TEXT },
        ],
        { abortSignal: controller.signal }
      )) {
        if (event.type === "text-delta") {
          receivedAnyDeltaBeforeAbort = true;
          controller.abort();
        }
      }
    } catch {
      abortHonoredAsError = true;
    }
    abortProbe = { ok: true, abortHonoredAsError, receivedAnyDeltaBeforeAbort };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    abortProbe = { ok: false, abortHonoredAsError: false, receivedAnyDeltaBeforeAbort: false, errorCode: normalized.errorCode };
  }

  return { ...base, completionProbe, streamingProbe, abortProbe };
}

export async function diagnoseAiProviders(params: { execute: boolean }): Promise<AiProviderDiagnoseResult> {
  const embedding = await diagnoseEmbedding(params.execute);
  const llm = await diagnoseLlm(params.execute);

  const circuitBreaker = getAiCircuitBreaker();
  const circuitBreakerStates: AiProviderDiagnoseResult["circuitBreakerStates"] = {};
  if (embedding.providerName) {
    circuitBreakerStates.embedding = await circuitBreaker.getState(embedding.providerName);
  }
  if (llm.providerName) {
    circuitBreakerStates.llm = await circuitBreaker.getState(llm.providerName);
  }

  return { executed: params.execute, embedding, llm, circuitBreakerStates };
}
