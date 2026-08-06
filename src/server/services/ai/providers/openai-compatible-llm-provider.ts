import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { classifyProviderHttpStatus, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";

import { executeWithResilience } from "./execute-with-resilience";

interface OpenAiCompatibleProviderConfig {
  baseUrl: string;
  apiKey?: string;
  /** Azure OpenAI uses `api-key: <key>` instead of `Authorization: Bearer <key>` - everything else about the request is identical. */
  authHeaderStyle?: "bearer" | "api-key";
  extraQueryParams?: Record<string, string>;
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
  defaultMaxOutputTokens?: number;
  defaultTemperature?: number;
}

/**
 * Real (not stubbed) implementation of the OpenAI Chat Completions API
 * shape - and, because it takes `baseUrl`/header-building as config
 * rather than hardcoding api.openai.com, this ONE class also serves
 * Azure OpenAI (same request/response shape, different base URL + an
 * `api-version` query param + `api-key` header instead of `Authorization:
 * Bearer`) and Ollama (its `/v1/chat/completions` endpoint is
 * OpenAI-compatible, typically no auth at all on localhost) - see
 * get-llm-provider.ts for how each is configured. `AI_LLM_PROVIDER=openai`
 * itself uses OpenAiResponsesLlmProvider instead (the current-generation
 * API - §Phase 13 Part D §12) - this class remains for the two providers
 * whose Responses-API support is either inconsistent (Azure's rollout) or
 * absent (Ollama).
 *
 * Routes every network attempt through executeWithResilience()
 * (§Phase 13 Part E). NOT live-network-verified in this session - no API
 * key/local Ollama instance is available in this sandbox.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  constructor(
    readonly providerName: string,
    readonly modelName: string,
    private readonly config: OpenAiCompatibleProviderConfig
  ) {}

  private buildUrl(): string {
    const url = new URL(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`);
    for (const [key, value] of Object.entries(this.config.extraQueryParams ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) {
      if (this.config.authHeaderStyle === "api-key") {
        headers["api-key"] = this.config.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
    }
    return headers;
  }

  async generateCompletion(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmCompletionResult> {
    return executeWithResilience({
      providerName: this.providerName,
      operation: "llm",
      circuitBreaker: this.config.circuitBreaker,
      timeoutMs: this.config.timeoutMs,
      retryPolicy: this.config.retryPolicy,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId,
      attempt: async (signal) => {
        const response = await fetch(this.buildUrl(), {
          method: "POST",
          headers: this.buildHeaders(),
          signal,
          body: JSON.stringify({
            model: this.modelName,
            messages,
            stream: false,
            max_tokens: options?.maxOutputTokens ?? this.config.defaultMaxOutputTokens,
            temperature: options?.temperature ?? this.config.defaultTemperature,
          }),
        });
        if (!response.ok) {
          throw new ProviderError({
            errorCode: classifyProviderHttpStatus(response.status),
            providerName: this.providerName,
            httpStatus: response.status,
          });
        }
        const body = (await response.json()) as {
          id?: string;
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        return {
          text: body.choices[0]?.message.content ?? "",
          usage: {
            promptTokens: body.usage?.prompt_tokens ?? 0,
            completionTokens: body.usage?.completion_tokens ?? 0,
          },
          providerRequestId: body.id,
        };
      },
    });
  }

  async *stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<AiStreamEvent> {
    const response = await executeWithResilience({
      providerName: this.providerName,
      operation: "llm",
      circuitBreaker: this.config.circuitBreaker,
      timeoutMs: this.config.timeoutMs,
      retryPolicy: this.config.retryPolicy,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId,
      attempt: async (signal) => {
        const res = await fetch(this.buildUrl(), {
          method: "POST",
          headers: this.buildHeaders(),
          signal,
          body: JSON.stringify({
            model: this.modelName,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: options?.maxOutputTokens ?? this.config.defaultMaxOutputTokens,
            temperature: options?.temperature ?? this.config.defaultTemperature,
          }),
        });
        if (!res.ok || !res.body) {
          throw new ProviderError({
            errorCode: classifyProviderHttpStatus(res.status),
            providerName: this.providerName,
            httpStatus: res.status,
          });
        }
        return res;
      },
    });

    // §16 - past this point, bytes may already be forwarded to the user;
    // any error from here on propagates AS-IS, never retried.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let providerRequestId: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              id?: string;
              choices: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (parsed.id && !providerRequestId) {
              providerRequestId = parsed.id;
              yield { type: "provider-request-id", value: providerRequestId };
            }
            const delta = parsed.choices[0]?.delta?.content;
            if (delta) yield { type: "text-delta", text: delta };
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
              outputTokens = parsed.usage.completion_tokens ?? outputTokens;
            }
          } catch {
            // A malformed/partial SSE chunk - skip it rather than crash the whole stream.
          }
        }
      }
    } catch (streamError) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, providerName: this.providerName, cause: streamError });
    }

    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done", finishReason: "stop" };
  }
}
