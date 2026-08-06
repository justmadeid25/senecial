/**
 * Phase 12 Part D/N, extended §Phase 13 Part D - provider-agnostic chat
 * completion. Every real provider (OpenAI/Azure OpenAI/Anthropic/Gemini/
 * Ollama - see src/server/services/ai/providers/) and the Development
 * provider implement this same shape; nothing above this interface (the
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
  providerRequestId?: string;
  /**
   * §Phase 13 Part F (§18) - "cache key/provenance에 실제 사용 provider
   * 포함". Only ever set by FallbackLlmProvider, and only when the
   * SECONDARY actually served the response - every other provider leaves
   * this undefined, meaning "identical to the top-level providerName/
   * modelName". Callers that need the TRUE served-by identity (usage
   * recording, provenance) must fall back to `providerName`/`modelName`
   * when these are undefined, never assume they are always present.
   */
  servedByProviderName?: string;
  servedByModelName?: string;
}

export interface LlmCallOptions {
  requestId?: string;
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
}

/**
 * §Phase 13 Part D (§11) - what a provider's stream ACTUALLY carries,
 * distinct from AskQuestionStreamEvent (features/ai/server/ask-question.ts),
 * which is the ORCHESTRATOR's own outward event shape after citation-gating
 * has been applied. No API Route or feature module ever consumes
 * AiStreamEvent directly - only ask-question.ts, which translates it.
 */
export type AiStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "provider-request-id"; value: string }
  /** `servedByProviderName`/`servedByModelName` - see LlmCompletionResult's identical fields; same "only FallbackLlmProvider ever sets these" rule. */
  | { type: "done"; finishReason?: string; servedByProviderName?: string; servedByModelName?: string };

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  /** Non-streaming - used by the evaluation CLI (Part J) and anywhere a single final string is all that's needed. */
  generateCompletion(messages: LlmMessage[], options?: LlmCallOptions): Promise<LlmCompletionResult>;
  /**
   * §Streaming - yields structured events as they become available. The
   * conversation orchestrator (features/ai/server/ask-question.ts)
   * forwards text-delta events to the client in real time, but only
   * PERSISTS the assembled final text as a Message after it passes
   * citation-required.ts's paragraph check - streaming is a UX
   * responsiveness concern, never a bypass of that check. A `usage` event
   * (when the provider's streaming API actually reports one) replaces the
   * chars/4 token-count approximation the orchestrator previously had to
   * fall back to.
   */
  stream(messages: LlmMessage[], options?: LlmCallOptions): AsyncIterable<AiStreamEvent>;
}
