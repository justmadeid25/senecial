/** Mirrors domain/ai/embedding-error-codes.ts's "safe, closed vocabulary" pattern for ContractDocumentChunkEmbeddingJob.errorCode. */
export const CHUNK_EMBEDDING_ERROR_CODES = {
  PROVIDER_ERROR: "PROVIDER_ERROR",
  CHUNK_NOT_FOUND: "CHUNK_NOT_FOUND",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  AI_POLICY_DISABLED: "AI_POLICY_DISABLED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
} as const;

export type ChunkEmbeddingErrorCode = (typeof CHUNK_EMBEDDING_ERROR_CODES)[keyof typeof CHUNK_EMBEDDING_ERROR_CODES];
