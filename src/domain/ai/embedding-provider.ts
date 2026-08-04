/**
 * Phase 12 Part A - provider-agnostic embedding generation. Every real
 * provider (OpenAI/Azure OpenAI/Anthropic/Gemini/Ollama - see
 * src/server/services/ai/providers/) and the Development provider
 * implement this same shape; nothing above this interface (queue,
 * hybrid search, retriever) ever imports a concrete provider class.
 */
export interface EmbeddingResult {
  vector: number[];
  dimension: number;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimension: number;
  generateEmbedding(text: string): Promise<EmbeddingResult>;
}
