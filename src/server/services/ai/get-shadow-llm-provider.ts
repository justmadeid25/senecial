import type { LlmProvider } from "@/domain/ai/llm-provider";

import { buildLlmProviderForDriver, loadSharedRuntimeConfig } from "./get-llm-provider";

let cachedProvider: LlmProvider | null | undefined;

/**
 * §Phase 13 Part F (§20) - a DEDICATED shadow-comparison provider,
 * intentionally separate from AI_SECONDARY_LLM_PROVIDER (which exists for
 * FAILOVER - a same-purpose fallback, often a cheaper/faster model).
 * Shadow mode's whole point is comparing a candidate model/provider's
 * quality against production, which is a different provider than
 * whatever failover would pick - conflating the two env var sets would
 * make it impossible to run a shadow comparison independent of the
 * failover configuration. Returns `null` (not a thrown error) when
 * AI_SHADOW_LLM_PROVIDER is unset - the caller (run-shadow-evaluation.ts)
 * treats that as "shadow mode has nothing configured to compare against"
 * and skips silently, never blocking the primary request.
 */
export function getShadowLlmProvider(): LlmProvider | null {
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }

  const driver = process.env.AI_SHADOW_LLM_PROVIDER;
  if (!driver) {
    cachedProvider = null;
    return cachedProvider;
  }

  cachedProvider = buildLlmProviderForDriver({
    driver,
    modelEnvVar: "AI_SHADOW_LLM_MODEL",
    apiKeyEnvVar: shadowApiKeyEnvVarForDriver(driver),
    isProduction: process.env.NODE_ENV === "production",
    shared: loadSharedRuntimeConfig(),
  });
  return cachedProvider;
}

function shadowApiKeyEnvVarForDriver(driver: string): string {
  if (driver === "development" || driver === "ollama") {
    return "";
  }
  return "AI_SHADOW_LLM_API_KEY";
}

export function resetShadowLlmProviderCacheForTests(): void {
  cachedProvider = undefined;
}
