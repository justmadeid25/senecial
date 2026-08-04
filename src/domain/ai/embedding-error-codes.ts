/** Mirrors domain/extraction/extraction-error-codes.ts's "safe, closed vocabulary" pattern - the only values ever written to EmbeddingJob.errorCode, never a raw provider exception message. */
export const EMBEDDING_ERROR_CODES = {
  PROVIDER_ERROR: "PROVIDER_ERROR",
  CLAUSE_NOT_FOUND: "CLAUSE_NOT_FOUND",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
} as const;

export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[keyof typeof EMBEDDING_ERROR_CODES];
