/** §Phase 13 Part G (§22) - closed vocabulary for AiUsageRecord.operationType. */
export const AI_USAGE_OPERATION_TYPES = {
  EMBEDDING: "embedding",
  LLM_ASK: "llm_ask",
  LLM_ASK_STREAM: "llm_ask_stream",
  EVALUATION: "evaluation",
} as const;

export type AiUsageOperationType = (typeof AI_USAGE_OPERATION_TYPES)[keyof typeof AI_USAGE_OPERATION_TYPES];
