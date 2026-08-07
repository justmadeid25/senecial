/**
 * §Phase 13.1 Part 10/11 - global canary rollout configuration, read once
 * per process (mirrors every other AI config module's env-parsing shape).
 * Distinct from AI_PROVIDER_FAILOVER_ENABLED's AI_SECONDARY_LLM_* (that is
 * an INFRA failover pair, always active for eligible errors); canary is a
 * DELIBERATE, percentage-controlled quality/cost experiment that only ever
 * applies to a stable subset of organizations, never in response to an
 * error.
 */
export interface AiRolloutConfiguration {
  canaryEnabled: boolean;
  /** 0-100. */
  canaryPercentage: number;
  canaryEmbeddingProvider?: string;
  canaryEmbeddingModel?: string;
  canaryLlmProvider?: string;
  canaryLlmModel?: string;
}

function parsePercentage(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

export function loadAiRolloutConfiguration(env: NodeJS.ProcessEnv = process.env): AiRolloutConfiguration {
  return {
    canaryEnabled: env.AI_CANARY_ENABLED === "true",
    canaryPercentage: parsePercentage(env.AI_CANARY_PERCENTAGE, 0),
    canaryEmbeddingProvider: env.AI_CANARY_EMBEDDING_PROVIDER || undefined,
    canaryEmbeddingModel: env.AI_CANARY_EMBEDDING_MODEL || undefined,
    canaryLlmProvider: env.AI_CANARY_LLM_PROVIDER || undefined,
    canaryLlmModel: env.AI_CANARY_LLM_MODEL || undefined,
  };
}
