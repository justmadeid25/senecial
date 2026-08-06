/** Mirrors domain/extraction/extraction-error-codes.ts's "safe, closed vocabulary" pattern - the only values ever written to EmbeddingJob.errorCode, never a raw provider exception message. */
export const EMBEDDING_ERROR_CODES = {
  PROVIDER_ERROR: "PROVIDER_ERROR",
  CLAUSE_NOT_FOUND: "CLAUSE_NOT_FOUND",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  /** §Phase 13 Part H (§30) - org.aiEnabled=false or allowExternalAiProcessing=false for a real provider. Not retry-worthy - the org's policy has to change first, so this fails the job immediately rather than leaving it PENDING for a retry that can never succeed. */
  AI_POLICY_DISABLED: "AI_POLICY_DISABLED",
  /** §Phase 13 Part G (§27) - the organization's monthly AI budget/quota reservation failed. Not retry-worthy on this same attempt (the period's budget is exhausted) - left PENDING so a future attempt (next month, or after an OWNER raises the limit) can still succeed, unlike AI_POLICY_DISABLED. */
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
} as const;

export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[keyof typeof EMBEDDING_ERROR_CODES];
