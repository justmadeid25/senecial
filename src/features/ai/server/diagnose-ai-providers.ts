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
  completionProbe?: { ok: boolean; latencyMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string };
  streamingProbe?: { ok: boolean; chunkCount?: number; receivedUsageEvent?: boolean; receivedProviderRequestId?: boolean; errorCode?: string };
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
    };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    completionProbe = { ok: false, latencyMs: Math.round(performance.now() - completionStart), errorCode: normalized.errorCode };
  }

  let streamingProbe: LlmDiagnoseResult["streamingProbe"];
  try {
    let chunkCount = 0;
    let receivedUsageEvent = false;
    let receivedProviderRequestId = false;
    for await (const event of provider.stream(messages)) {
      if (event.type === "text-delta") chunkCount += 1;
      if (event.type === "usage") receivedUsageEvent = true;
      if (event.type === "provider-request-id") receivedProviderRequestId = true;
    }
    streamingProbe = { ok: true, chunkCount, receivedUsageEvent, receivedProviderRequestId };
  } catch (error) {
    const normalized = normalizeProviderError({ error, providerName: provider.providerName });
    streamingProbe = { ok: false, errorCode: normalized.errorCode };
  }

  return { ...base, completionProbe, streamingProbe };
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
