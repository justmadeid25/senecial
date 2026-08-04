import type { LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";

/**
 * Real (not stubbed) implementation of Anthropic's Messages API shape
 * (`system` is a top-level field, not a message with role "system" - the
 * one structural difference from the OpenAI shape this class has to
 * handle itself). NOT live-network-verified in this session - no
 * ANTHROPIC_API_KEY is available in this sandbox.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly providerName = "anthropic";

  constructor(
    readonly modelName: string,
    private readonly config: { apiKey: string; baseUrl?: string; maxTokens?: number }
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

  async generateCompletion(messages: LlmMessage[]): Promise<LlmCompletionResult> {
    const { system, rest } = this.splitSystemMessage(messages);
    const response = await fetch(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        system,
        messages: rest,
        max_tokens: this.config.maxTokens ?? 2048,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic 요청 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = body.content.find((block) => block.type === "text")?.text ?? "";
    return {
      text,
      usage: { promptTokens: body.usage?.input_tokens ?? 0, completionTokens: body.usage?.output_tokens ?? 0 },
    };
  }

  async *streamCompletion(messages: LlmMessage[]): AsyncIterable<string> {
    const { system, rest } = this.splitSystemMessage(messages);
    const response = await fetch(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        system,
        messages: rest,
        max_tokens: this.config.maxTokens ?? 2048,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Anthropic streaming 요청 실패 (HTTP ${response.status})`);
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
        try {
          const parsed = JSON.parse(payload) as {
            type: string;
            delta?: { type: string; text?: string };
          };
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          // A malformed/partial SSE chunk - skip it rather than crash the whole stream.
        }
      }
    }
  }
}
