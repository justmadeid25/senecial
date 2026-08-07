import type { LlmProvider } from "@/domain/ai/llm-provider";

import { buildLlmProviderForDriver, loadSharedRuntimeConfig } from "./get-llm-provider";

let cachedProvider: LlmProvider | null | undefined;

/**
 * §Phase 13.1 Part 10/11 - the canary LLM provider, built from its OWN env
 * var namespace (AI_CANARY_LLM_*) - deliberately separate from
 * AI_SECONDARY_LLM_* (failover) and AI_SHADOW_LLM_* (shadow comparison,
 * never user-facing) - canary is a percentage of REAL organizations
 * actually served by this provider, not a fallback or an async
 * comparison. No failover wrapping is applied to the canary provider
 * itself in this Phase (kept simple - a canary-serving request that fails
 * is just a normal provider failure, not silently re-routed).
 */
export function getCanaryLlmProvider(): LlmProvider | null {
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }

  const driver = process.env.AI_CANARY_LLM_PROVIDER;
  if (!driver) {
    cachedProvider = null;
    return cachedProvider;
  }

  cachedProvider = buildLlmProviderForDriver({
    driver,
    modelEnvVar: "AI_CANARY_LLM_MODEL",
    apiKeyEnvVar: canaryApiKeyEnvVarForDriver(driver),
    isProduction: process.env.NODE_ENV === "production",
    shared: loadSharedRuntimeConfig(),
  });
  return cachedProvider;
}

function canaryApiKeyEnvVarForDriver(driver: string): string {
  if (driver === "development" || driver === "ollama") {
    return "";
  }
  return "AI_CANARY_LLM_API_KEY";
}

export function resetCanaryLlmProviderCacheForTests(): void {
  cachedProvider = undefined;
}
