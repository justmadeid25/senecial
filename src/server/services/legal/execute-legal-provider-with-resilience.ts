import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import { getLogger } from "@/server/logging";

import {
  assertLegalProviderCallAllowed,
  LEGAL_PROVIDER_ERROR_CODES,
  LegalProviderError,
  normalizeLegalProviderError,
} from "@/domain/legal";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LegalRetryPolicyConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_LEGAL_RETRY_POLICY: LegalRetryPolicyConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

/** Same "500ms / 1500ms / 4000ms, full jitter in [0.5x, 1.0x]" shape as domain/ai/retry-policy.ts's computeBackoffMs() - duplicated (not imported) to keep the legal domain independent of domain/ai per this module's own isolation rationale (see execute-legal-provider-with-resilience.ts's header). */
export function computeLegalBackoffMs(
  attemptIndex: number,
  config: LegalRetryPolicyConfig = DEFAULT_LEGAL_RETRY_POLICY,
  randomFn: () => number = Math.random
): number {
  const exponential = Math.min(config.baseDelayMs * Math.pow(3, attemptIndex), config.maxDelayMs);
  const jitterFactor = 0.5 + randomFn() * 0.5;
  return Math.floor(exponential * jitterFactor);
}

export interface ExecuteLegalProviderWithResilienceParams<T> {
  providerName: string;
  operation: "search" | "fetch";
  circuitBreaker: CircuitBreaker;
  /** Key the shared circuit breaker tracks state under - deliberately distinct from `providerName` so this provider's health never mixes with an AI provider's health even if the same CircuitBreaker instance (getAiCircuitBreaker()) is reused for its shared-storage convenience (see get-law-open-data-provider.ts). */
  circuitBreakerKey: string;
  timeoutMs: number;
  retryPolicy?: LegalRetryPolicyConfig;
  abortSignal?: AbortSignal;
  requestId?: string;
  attempt: (signal: AbortSignal) => Promise<T>;
}

/**
 * §Phase L1 §0/§1 - the single call site every Law Open Data provider
 * attempt routes through: paid/real-call guard -> circuit-breaker gate ->
 * timeout -> error normalization -> retry classification -> backoff+jitter.
 * Mirrors server/services/ai/providers/execute-with-resilience.ts's shape
 * exactly, but kept as an independent module (not a shared refactor) so
 * this phase never touches the existing AI provider call path (AGENTS.md:
 * "do not refactor unrelated AI code").
 */
export async function executeLegalProviderWithResilience<T>(params: ExecuteLegalProviderWithResilienceParams<T>): Promise<T> {
  const { providerName, operation, circuitBreaker, circuitBreakerKey, timeoutMs, requestId } = params;
  const retryPolicy = params.retryPolicy ?? DEFAULT_LEGAL_RETRY_POLICY;

  assertLegalProviderCallAllowed({ providerName, operation });

  const token = await circuitBreaker.beforeCall(circuitBreakerKey);
  if (!token.allowed) {
    getLogger().warn("legal_provider.circuit_open", { providerName, operation });
    throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE, providerName });
  }

  let lastError: LegalProviderError | undefined;

  for (let attemptIndex = 0; attemptIndex <= retryPolicy.maxRetries; attemptIndex++) {
    if (params.abortSignal?.aborted) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_ABORTED, providerName });
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    params.abortSignal?.addEventListener("abort", onAbort);
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const start = performance.now();
    try {
      const result = await params.attempt(controller.signal);
      await circuitBreaker.onSuccess(circuitBreakerKey);
      getLogger().info("legal_provider.call_succeeded", {
        providerName,
        operation,
        latencyMs: Math.round(performance.now() - start),
      });
      return result;
    } catch (rawError) {
      const error = normalizeLegalProviderError({ error: rawError, providerName });
      lastError = error;
      await circuitBreaker.onFailure(circuitBreakerKey);

      const canRetry = error.retryable && attemptIndex < retryPolicy.maxRetries && !params.abortSignal?.aborted;

      if (!canRetry) {
        getLogger().warn("legal_provider.call_failed", {
          providerName,
          operation,
          errorCode: error.errorCode,
          attempt: attemptIndex,
          requestId: requestId ?? "",
        });
        throw error;
      }

      const delayMs = computeLegalBackoffMs(attemptIndex, retryPolicy);
      getLogger().warn("legal_provider.retrying", { providerName, operation, errorCode: error.errorCode, attempt: attemptIndex, delayMs });
      await sleep(delayMs);
    } finally {
      clearTimeout(timeoutHandle);
      params.abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNKNOWN, providerName });
}
