/**
 * Phase 12 Part D/N - provider-agnostic chat completion. Every real
 * provider (OpenAI/Azure OpenAI/Anthropic/Gemini/Ollama - see
 * src/server/services/ai/providers/) and the Development provider
 * implement this same shape; nothing above this interface (the
 * conversation orchestrator, the Route Handler) ever imports a concrete
 * provider class - mirrors embedding-provider.ts's identical contract.
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCompletionResult {
  text: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  /** Non-streaming - used by the evaluation CLI (Part J) and anywhere a single final string is all that's needed. */
  generateCompletion(messages: LlmMessage[]): Promise<LlmCompletionResult>;
  /**
   * §Streaming - yields text deltas as they become available. The
   * conversation orchestrator (features/ai/server/ask-question.ts)
   * forwards each delta to the client in real time, but only PERSISTS the
   * assembled final text as a Message after it passes
   * citation-required.ts's paragraph check - streaming is a UX
   * responsiveness concern, never a bypass of that check.
   */
  streamCompletion(messages: LlmMessage[]): AsyncIterable<string>;
}
