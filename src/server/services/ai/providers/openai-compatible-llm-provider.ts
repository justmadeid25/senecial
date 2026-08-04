import type { LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";

/**
 * Real (not stubbed) implementation of the OpenAI Chat Completions API
 * shape - and, because it takes `baseUrl`/header-building as config
 * rather than hardcoding api.openai.com, this ONE class also serves
 * Azure OpenAI (same request/response shape, different base URL + an
 * `api-version` query param + `api-key` header instead of `Authorization:
 * Bearer`) and Ollama (its `/v1/chat/completions` endpoint is
 * OpenAI-compatible, typically no auth at all on localhost) - see
 * get-llm-provider.ts for how each is configured.
 *
 * NOT live-network-verified in this session - no API key/local Ollama
 * instance is available in this sandbox (same "real code, untested
 * without a credential" status as this codebase's ses/resend/sendgrid
 * mail provider extension points, or Phase 10B's real Postmark client
 * before it was verified with Postmark's own public test token - no
 * equivalent public test credential exists for a chat completion API).
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  constructor(
    readonly providerName: string,
    readonly modelName: string,
    private readonly config: {
      baseUrl: string;
      apiKey?: string;
      /** Azure OpenAI uses `api-key: <key>` instead of `Authorization: Bearer <key>` - everything else about the request is identical. */
      authHeaderStyle?: "bearer" | "api-key";
      extraQueryParams?: Record<string, string>;
    }
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

  async generateCompletion(messages: LlmMessage[]): Promise<LlmCompletionResult> {
    const response = await fetch(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ model: this.modelName, messages, stream: false }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI-compatible completion 요청 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      text: body.choices[0]?.message.content ?? "",
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *streamCompletion(messages: LlmMessage[]): AsyncIterable<string> {
    const response = await fetch(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ model: this.modelName, messages, stream: true }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`OpenAI-compatible streaming 요청 실패 (HTTP ${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as { choices: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // A malformed/partial SSE chunk - skip it rather than crash the whole stream.
        }
      }
    }
  }
}
