import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import { computeBackoffMs, DEFAULT_RETRY_POLICY, type RetryPolicyConfig } from "@/domain/ai/retry-policy";
import { assertPaidProviderCallAllowed } from "@/domain/ai/paid-provider-guard";
import { normalizeProviderError, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import { getLogger } from "@/server/logging";
import { recordCircuitState, recordProviderCall } from "@/server/monitoring/metrics";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ExecuteWithResilienceParams<T> {
  providerName: string;
  operation: "embedding" | "llm";
  circuitBreaker: CircuitBreaker;
  timeoutMs: number;
  retryPolicy?: RetryPolicyConfig;
  abortSignal?: AbortSignal;
  requestId?: string;
  /** Receives a per-attempt AbortSignal that fires on timeout OR the caller's own abortSignal. */
  attempt: (signal: AbortSignal) => Promise<T>;
  /**
   * §16 - "streaming 중 일부 token을 이미 사용자에게 전송한 뒤에는 자동
   * 재시도하지 마십시오" - once true, no further retry is attempted even
   * if the error is otherwise retryable. Defaults to always-allowed.
   */
  isRetryAllowed?: (attemptIndex: number) => boolean;
}

/**
 * §Phase 13 Part E - the single call site every real provider (embedding
 * or LLM) routes its network attempt through: circuit-breaker gate ->
 * timeout -> error normalization -> retry classification -> backoff+jitter.
 * Never retries a non-retryable ProviderError (auth/invalid-request/
 * content-blocked/context-too-large/abort - see
 * isRetryableProviderErrorCode()) and never exceeds retryPolicy.maxRetries
 * regardless of error type.
 */
export async function executeWithResilience<T>(params: ExecuteWithResilienceParams<T>): Promise<T> {
  const { providerName, operation, circuitBreaker, timeoutMs, requestId } = params;
  const retryPolicy = params.retryPolicy ?? DEFAULT_RETRY_POLICY;

  // §Phase 13.2 - checked BEFORE the circuit breaker/retry loop so a block
  // here is never counted as a provider failure or retried - it is a
  // local policy decision, not something the provider returned.
  assertPaidProviderCallAllowed({ providerName, operation });

  const token = await circuitBreaker.beforeCall(providerName);
  recordCircuitState(providerName, token.state);
  if (!token.allowed) {
    getLogger().warn("ai_provider.circuit_open", { providerName, operation });
    recordProviderCall({ providerName, operation, success: false, errorCode: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE });
    throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE, providerName });
  }

  let lastError: ProviderError | undefined;

  for (let attemptIndex = 0; attemptIndex <= retryPolicy.maxRetries; attemptIndex++) {
    if (params.abortSignal?.aborted) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, providerName });
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    params.abortSignal?.addEventListener("abort", onAbort);
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const start = performance.now();
    try {
      const result = await params.attempt(controller.signal);
      await circuitBreaker.onSuccess(providerName);
      recordCircuitState(providerName, "CLOSED");
      recordProviderCall({ providerName, operation, success: true, latencyMs: performance.now() - start });
      return result;
    } catch (rawError) {
      const error = normalizeProviderError({ error: rawError, providerName });
      lastError = error;
      await circuitBreaker.onFailure(providerName);
      recordCircuitState(providerName, await circuitBreaker.getState(providerName));
      recordProviderCall({
        providerName,
        operation,
        success: false,
        latencyMs: performance.now() - start,
        errorCode: error.errorCode,
      });

      const canRetry =
        error.retryable &&
        attemptIndex < retryPolicy.maxRetries &&
        (params.isRetryAllowed?.(attemptIndex) ?? true) &&
        !params.abortSignal?.aborted;

      if (!canRetry) {
        getLogger().warn("ai_provider.call_failed", {
          providerName,
          operation,
          errorCode: error.errorCode,
          attempt: attemptIndex,
          requestId: requestId ?? "",
        });
        throw error;
      }

      const delayMs = computeBackoffMs(attemptIndex, retryPolicy);
      getLogger().warn("ai_provider.retrying", { providerName, operation, errorCode: error.errorCode, attempt: attemptIndex, delayMs });
      await sleep(delayMs);
    } finally {
      clearTimeout(timeoutHandle);
      params.abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN, providerName });
}
