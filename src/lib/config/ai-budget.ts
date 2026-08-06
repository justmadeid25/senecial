/**
 * §Phase 13 Part G (§27) - the worst-case output-token ceiling used to
 * size a PRE-CALL budget reservation (see ask-question.ts's
 * reserveLlmBudget()). Mirrors AI_LLM_MAX_OUTPUT_TOKENS (the same value
 * providers use as their own default max_output_tokens - see
 * get-llm-provider.ts) so the reservation's worst case matches what the
 * provider could actually be asked to generate; falls back to a
 * reasonable 2048-token ceiling when no explicit limit is configured.
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE = parsePositiveInt(process.env.AI_LLM_MAX_OUTPUT_TOKENS, 2048);
