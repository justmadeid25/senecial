import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { classifyProviderHttpStatus, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";

import { executeWithResilience } from "./execute-with-resilience";

interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
}

/**
 * Real (not stubbed) implementation of Anthropic's Messages API shape
 * (`system` is a top-level field, not a message with role "system" - the
 * one structural difference from the OpenAI shape this class has to
 * handle itself). Routes every network attempt through
 * executeWithResilience() (timeout/retry/circuit-breaker/error
 * normalization - §Phase 13 Part E). NOT live-network-verified in this
 * session - no ANTHROPIC_API_KEY is available in this sandbox.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly providerName = "anthropic";

  constructor(
    readonly modelName: string,
    private readonly config: AnthropicProviderConfig
  ) {}

  private splitSystemMessage(messages: LlmMessage[]): { system: string | undefined; rest: LlmMessage[] } {
    const system = messages.find((m) => m.role === "system")?.content;
    const rest = messages.filter((m) => m.role !== "system");
    return { system, rest };
  }

  private buildUrl(): string {
    return `${(this.config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async generateCompletion(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmCompletionResult> {
    const { system, rest } = this.splitSystemMessage(messages);
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
            system,
            messages: rest,
            max_tokens: options?.maxOutputTokens ?? this.config.maxTokens ?? 2048,
            temperature: options?.temperature,
            stream: false,
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
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number };
          id?: string;
        };
        const text = body.content.find((block) => block.type === "text")?.text ?? "";
        return {
          text,
          usage: { promptTokens: body.usage?.input_tokens ?? 0, completionTokens: body.usage?.output_tokens ?? 0 },
          providerRequestId: body.id,
        };
      },
    });
  }

  async *stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<AiStreamEvent> {
    const { system, rest } = this.splitSystemMessage(messages);

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
            system,
            messages: rest,
            max_tokens: options?.maxOutputTokens ?? this.config.maxTokens ?? 2048,
            temperature: options?.temperature,
            stream: true,
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
    let messageId: string | undefined;

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
          try {
            const parsed = JSON.parse(payload) as {
              type: string;
              delta?: { type: string; text?: string };
              message?: { id?: string; usage?: { input_tokens?: number } };
              usage?: { output_tokens?: number };
            };
            if (parsed.type === "message_start") {
              messageId = parsed.message?.id;
              inputTokens = parsed.message?.usage?.input_tokens ?? 0;
              if (messageId) yield { type: "provider-request-id", value: messageId };
            } else if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              yield { type: "text-delta", text: parsed.delta.text };
            } else if (parsed.type === "message_delta" && parsed.usage?.output_tokens !== undefined) {
              outputTokens = parsed.usage.output_tokens;
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
