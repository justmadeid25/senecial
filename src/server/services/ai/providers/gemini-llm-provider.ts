import type { LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";

/**
 * Real (not stubbed) implementation of Google's Gemini `generateContent`/
 * `streamGenerateContent` API shape. Gemini has no separate "system"
 * role - it uses a top-level `systemInstruction` field, and its
 * conversation turns use `role: "user" | "model"` (not "assistant") with
 * a `parts: [{text}]` array instead of a plain `content` string - this
 * class does that translation. NOT live-network-verified in this
 * session - no GEMINI_API_KEY is available in this sandbox.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly providerName = "gemini";

  constructor(readonly modelName: string, private readonly config: { apiKey: string; baseUrl?: string }) {}

  private baseUrl(): string {
    return (this.config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  private toGeminiContents(messages: LlmMessage[]): { systemInstruction?: object; contents: object[] } {
    const system = messages.find((m) => m.role === "system")?.content;
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
    };
  }

  async generateCompletion(messages: LlmMessage[]): Promise<LlmCompletionResult> {
    const url = `${this.baseUrl()}/v1beta/models/${this.modelName}:generateContent?key=${this.config.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.toGeminiContents(messages)),
    });
    if (!response.ok) {
      throw new Error(`Gemini 요청 실패 (HTTP ${response.status})`);
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
  }

  async *streamCompletion(messages: LlmMessage[]): AsyncIterable<string> {
    const url = `${this.baseUrl()}/v1beta/models/${this.modelName}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.toGeminiContents(messages)),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Gemini streaming 요청 실패 (HTTP ${response.status})`);
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
        try {
          const parsed = JSON.parse(trimmed.slice("data:".length).trim()) as {
            candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>;
          };
          const text = parsed.candidates?.[0]?.content.parts.map((p) => p.text ?? "").join("");
          if (text) yield text;
        } catch {
          // A malformed/partial SSE chunk - skip it rather than crash the whole stream.
        }
      }
    }
  }
}
