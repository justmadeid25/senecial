import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { classifyProviderHttpStatus, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";

import { executeWithResilience } from "./execute-with-resilience";
import { attachStreamAbortGuard } from "./stream-abort-guard";

export const OPENAI_LLM_DEFAULT_MODEL = "gpt-4.1-mini";

interface OpenAiResponsesConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
  defaultMaxOutputTokens?: number;
  defaultTemperature?: number;
}

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface ResponsesApiResult {
  id?: string;
  output?: Array<{ type: string; role?: string; content?: Array<{ type: string; text?: string }> }>;
  usage?: ResponsesUsage;
}

/**
 * §Phase 13 Part D (§12) - OpenAI's current-generation Responses API
 * (`/v1/responses`), NOT the older Chat Completions shape - this
 * codebase's pre-existing `openai` driver used Chat Completions
 * (openai-compatible-llm-provider.ts), which Part D §12 explicitly says
 * not to newly introduce for a real integration ("구형 completion API를
 * 새로 도입하지 마십시오"). `input` accepts the same
 * `{role, content}[]` shape this codebase already builds via
 * prompt-builder.ts (including a `role: "system"` entry), so no message
 * translation is needed the way Anthropic/Gemini require.
 *
 * Routes every network attempt through executeWithResilience()
 * (§Phase 13 Part E). NOT live-network-verified in this session - no
 * OPENAI_API_KEY is available in this sandbox.
 */
export class OpenAiResponsesLlmProvider implements LlmProvider {
  readonly providerName = "openai";

  constructor(
    readonly modelName: string,
    private readonly config: OpenAiResponsesConfig
  ) {}

  private buildUrl(): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/responses`;
  }

  private buildHeaders(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` };
  }

  private buildBody(messages: LlmMessage[], options: LlmCallOptions | undefined, stream: boolean): Record<string, unknown> {
    return {
      model: this.modelName,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: options?.maxOutputTokens ?? this.config.defaultMaxOutputTokens,
      temperature: options?.temperature ?? this.config.defaultTemperature,
      stream,
      // §Phase 13.1 Part 3 - ALWAYS explicit, never left to the API's own
      // default (which may retain request/response data server-side for a
      // period - see docs/operations/ai-platform.md's "Data Governance"
      // section for exactly what store:false does and does NOT guarantee,
      // e.g. it is NOT the same as an approved Zero Data Retention
      // agreement). No hosted tool/file/vector store is ever referenced
      // here either - only the plain `input` messages this class itself
      // built from already-minimized citation evidence (see
      // domain/ai/prompt-builder.ts).
      store: false,
    };
  }

  private extractText(output: ResponsesApiResult["output"]): string {
    if (!output) return "";
    return output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((block) => block.type === "output_text")
      .map((block) => block.text ?? "")
      .join("");
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
          body: JSON.stringify(this.buildBody(messages, options, false)),
        });
        if (!response.ok) {
          throw new ProviderError({
            errorCode: classifyProviderHttpStatus(response.status),
            providerName: this.providerName,
            httpStatus: response.status,
          });
        }
        const body = (await response.json()) as ResponsesApiResult;
        return {
          text: this.extractText(body.output),
          usage: { promptTokens: body.usage?.input_tokens ?? 0, completionTokens: body.usage?.output_tokens ?? 0 },
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
          body: JSON.stringify(this.buildBody(messages, options, true)),
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
          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              type: string;
              delta?: string;
              response?: { id?: string; usage?: ResponsesUsage };
            };
            if (parsed.type === "response.created" && parsed.response?.id && !providerRequestId) {
              providerRequestId = parsed.response.id;
              yield { type: "provider-request-id", value: providerRequestId };
            } else if (parsed.type === "response.output_text.delta" && parsed.delta) {
              yield { type: "text-delta", text: parsed.delta };
            } else if (parsed.type === "response.completed") {
              inputTokens = parsed.response?.usage?.input_tokens ?? inputTokens;
              outputTokens = parsed.response?.usage?.output_tokens ?? outputTokens;
              if (parsed.response?.id && !providerRequestId) {
                providerRequestId = parsed.response.id;
                yield { type: "provider-request-id", value: providerRequestId };
              }
            } else if (parsed.type === "error") {
              throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID, providerName: this.providerName });
            }
          } catch (parseError) {
            if (parseError instanceof ProviderError) throw parseError;
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
