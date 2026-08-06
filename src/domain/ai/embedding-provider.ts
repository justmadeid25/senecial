/**
 * Phase 12 Part A, extended §Phase 13 Part C/F - provider-agnostic
 * embedding generation. Every real provider (OpenAI/Azure OpenAI/
 * Anthropic/Gemini/Ollama - see src/server/services/ai/providers/) and the
 * Development provider implement this same shape; nothing above this
 * interface (queue, hybrid search, retriever) ever imports a concrete
 * provider class.
 *
 * `options` is a second, optional parameter (not a breaking change to
 * existing single-string call sites) - `requestId` propagates into
 * provider logs/metrics (never persisted in EmbeddingJob.errorMessage
 * etc. - see domain/ai/provider-error.ts's own "never store the raw
 * provider text" rule), `abortSignal` lets a caller cancel an in-flight
 * request (e.g. a worker shutdown).
 */
export interface EmbeddingResult {
  vector: number[];
  dimension: number;
  /** Only ever set by a REAL provider that actually reports usage - the Development provider never fabricates a token count here (see recordEstimatedCostMinor()'s "never disguise unknown as zero" rule). */
  usage?: { inputTokens?: number };
  /** A short, safe-to-store opaque identifier (see domain/ai/provider-error.ts) - never a full request/response echo. */
  providerRequestId?: string;
}

export interface EmbeddingBatchItemResult extends EmbeddingResult {
  /** Index into the ORIGINAL input `texts` array - batch responses are not always guaranteed to preserve order by every provider, so callers must never assume `results[i]` corresponds to `texts[i]` without checking this. */
  index: number;
}

export interface EmbeddingBatchResult {
  results: EmbeddingBatchItemResult[];
}

export interface EmbeddingCallOptions {
  requestId?: string;
  abortSignal?: AbortSignal;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimension: number;
  generateEmbedding(text: string, options?: EmbeddingCallOptions): Promise<EmbeddingResult>;
  /**
   * §Phase 13 Part C (§7) - optional: only providers whose API genuinely
   * batches (one HTTP round trip for many inputs, real cost/latency win)
   * implement this. Callers (the embedding backfill CLI) must fall back to
   * sequential generateEmbedding() calls when this is undefined - never
   * assume every provider has it.
   */
  generateEmbeddings?(texts: string[], options?: EmbeddingCallOptions): Promise<EmbeddingBatchResult>;
}
