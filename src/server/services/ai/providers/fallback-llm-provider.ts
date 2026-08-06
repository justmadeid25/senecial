import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { isFallbackEligibleProviderErrorCode, normalizeProviderError } from "@/domain/ai/provider-error";
import { getLogger } from "@/server/logging";
import { recordProviderFallback } from "@/server/monitoring/metrics";

/**
 * §Phase 13 Part F (§18) - wraps a primary LlmProvider with a secondary
 * one, falling back ONLY on the narrow, infrastructure-shaped error set
 * (timeout/rate-limit/unavailable/circuit-open - see
 * isFallbackEligibleProviderErrorCode()). Never falls back on abort,
 * invalid-request, content-blocked, or context-too-large - §18's explicit
 * "금지 후보" list, enforced by reusing the same classification the retry
 * policy uses (a fallback-eligible error is always also retry-eligible,
 * but executeWithResilience() has already exhausted retries by the time
 * this decorator's catch block runs).
 */
export class FallbackLlmProvider implements LlmProvider {
  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
    private readonly circuitBreaker: CircuitBreaker
  ) {}

  get providerName(): string {
    return this.primary.providerName;
  }

  get modelName(): string {
    return this.primary.modelName;
  }

  /**
   * §18 - "cache key에 실제 provider 포함": a best-effort, CHEAP (single
   * circuit-breaker state read, no network call) prediction of which
   * provider will actually serve the next call, so the prompt cache key
   * (built BEFORE the real call, to allow skipping it entirely on a hit)
   * reflects the provider actually in use during a SUSTAINED outage (the
   * case that matters operationally - a single transient blip already
   * recovers via executeWithResilience()'s own retry before ever reaching
   * fallback). Not race-free against a failure that happens strictly
   * between this check and the real call - a rare, narrow window,
   * documented rather than silently claimed to be perfectly precise.
   */
  async peekEffectiveIdentity(): Promise<{ providerName: string; modelName: string }> {
    const state = await this.circuitBreaker.getState(this.primary.providerName);
    return state === "OPEN"
      ? { providerName: this.secondary.providerName, modelName: this.secondary.modelName }
      : { providerName: this.primary.providerName, modelName: this.primary.modelName };
  }

  async generateCompletion(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmCompletionResult> {
    try {
      return await this.primary.generateCompletion(messages, options);
    } catch (rawError) {
      const error = normalizeProviderError({ error: rawError, providerName: this.primary.providerName });
      if (!isFallbackEligibleProviderErrorCode(error.errorCode)) {
        throw error;
      }
      getLogger().warn("ai_provider.fallback", {
        from: this.primary.providerName,
        to: this.secondary.providerName,
        errorCode: error.errorCode,
      });
      recordProviderFallback();
      const result = await this.secondary.generateCompletion(messages, options);
      return { ...result, servedByProviderName: this.secondary.providerName, servedByModelName: this.secondary.modelName };
    }
  }

  async *stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<AiStreamEvent> {
    let yieldedAnyText = false;
    try {
      for await (const event of this.primary.stream(messages, options)) {
        if (event.type === "text-delta") {
          yieldedAnyText = true;
        }
        yield event;
      }
      return;
    } catch (rawError) {
      // §16 - once partial output has already reached the user, never
      // silently switch providers mid-stream (risks a duplicated/
      // inconsistent answer) - propagate the failure as-is instead.
      if (yieldedAnyText) {
        throw rawError;
      }
      const error = normalizeProviderError({ error: rawError, providerName: this.primary.providerName });
      if (!isFallbackEligibleProviderErrorCode(error.errorCode)) {
        throw error;
      }
      getLogger().warn("ai_provider.fallback", {
        from: this.primary.providerName,
        to: this.secondary.providerName,
        errorCode: error.errorCode,
      });
      recordProviderFallback();
    }
    // §18 - past this point every event comes from the secondary, so the
    // "done" event (the only one usage-recording call sites read a
    // served-by identity from) is tagged with the secondary's real
    // identity - never left implying the primary served this stream.
    for await (const event of this.secondary.stream(messages, options)) {
      if (event.type === "done") {
        yield { ...event, servedByProviderName: this.secondary.providerName, servedByModelName: this.secondary.modelName };
      } else {
        yield event;
      }
    }
  }
}

export function isFallbackLlmProvider(provider: LlmProvider): provider is FallbackLlmProvider {
  return provider instanceof FallbackLlmProvider;
}
