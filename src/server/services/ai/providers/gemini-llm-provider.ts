import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { classifyProviderHttpStatus, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";

import { executeWithResilience } from "./execute-with-resilience";
import { attachStreamAbortGuard } from "./stream-abort-guard";

interface GeminiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
  defaultMaxOutputTokens?: number;
  defaultTemperature?: number;
}

/**
 * Real (not stubbed) implementation of Google's Gemini `generateContent`/
 * `streamGenerateContent` API shape. Gemini has no separate "system"
 * role - it uses a top-level `systemInstruction` field, and its
 * conversation turns use `role: "user" | "model"` (not "assistant") with
 * a `parts: [{text}]` array instead of a plain `content` string - this
 * class does that translation. Routes every network attempt through
 * executeWithResilience() (§Phase 13 Part E). NOT live-network-verified in
 * this session - no GEMINI_API_KEY is available in this sandbox.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly providerName = "gemini";

  constructor(
    readonly modelName: string,
    private readonly config: GeminiProviderConfig
  ) {}

  private baseUrl(): string {
    return (this.config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  private toGeminiContents(
    messages: LlmMessage[],
    options?: LlmCallOptions
  ): { systemInstruction?: object; contents: object[]; generationConfig?: object } {
    const system = messages.find((m) => m.role === "system")?.content;
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const maxOutputTokens = options?.maxOutputTokens ?? this.config.defaultMaxOutputTokens;
    const temperature = options?.temperature ?? this.config.defaultTemperature;
    const generationConfig = maxOutputTokens !== undefined || temperature !== undefined ? { maxOutputTokens, temperature } : undefined;
    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig,
    };
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
        const url = `${this.baseUrl()}/v1beta/models/${this.modelName}:generateContent?key=${this.config.apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify(this.toGeminiContents(messages, options)),
        });
        if (!response.ok) {
          throw new ProviderError({
            errorCode: classifyProviderHttpStatus(response.status),
            providerName: this.providerName,
            httpStatus: response.status,
          });
        }
        const body = (await response.json()) as {
          candidates: Array<{ content: { parts: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
        };
        const text = body.candidates[0]?.content.parts.map((p) => p.text ?? "").join("") ?? "";
        return {
          text,
          usage: {
            promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
            completionTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
          },
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
        const url = `${this.baseUrl()}/v1beta/models/${this.modelName}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify(this.toGeminiContents(messages, options)),
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
    const abortGuard = attachStreamAbortGuard(reader, options?.abortSignal, this.providerName);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          abortGuard.checkAborted();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          try {
            const parsed = JSON.parse(trimmed.slice("data:".length).trim()) as {
              candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>;
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            };
            const text = parsed.candidates?.[0]?.content.parts.map((p) => p.text ?? "").join("");
            if (text) yield { type: "text-delta", text };
            if (parsed.usageMetadata) {
              inputTokens = parsed.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = parsed.usageMetadata.candidatesTokenCount ?? outputTokens;
            }
          } catch {
            // A malformed/partial SSE chunk - skip it rather than crash the whole stream.
          }
        }
      }
    } catch (streamError) {
      if (streamError instanceof ProviderError) throw streamError;
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, providerName: this.providerName, cause: streamError });
    } finally {
      abortGuard.cleanup();
    }

    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done", finishReason: "stop" };
  }
}
