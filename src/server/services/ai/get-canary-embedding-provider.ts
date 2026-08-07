import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";

import { buildEmbeddingProviderForDriver } from "./get-embedding-provider";

let cachedProvider: EmbeddingProvider | null | undefined;

const CANARY_ENV_NAMES = {
  driverEnvVar: "AI_CANARY_EMBEDDING_PROVIDER",
  apiKeyEnvVar: "AI_CANARY_EMBEDDING_API_KEY",
  baseUrlEnvVar: "AI_CANARY_EMBEDDING_BASE_URL",
  modelEnvVar: "AI_CANARY_EMBEDDING_MODEL",
  dimensionEnvVar: "AI_CANARY_EMBEDDING_DIMENSION",
  timeoutEnvVar: "AI_CANARY_EMBEDDING_TIMEOUT_MS",
  retriesEnvVar: "AI_CANARY_EMBEDDING_MAX_RETRIES",
  allowDevOverrideEnvVar: "ALLOW_DEVELOPMENT_AI_PROVIDER",
} as const;

/**
 * §Phase 13.1 Part 10/11 - the canary embedding provider, built from its
 * OWN env var namespace (AI_CANARY_EMBEDDING_*) so it can differ from the
 * primary in model/dimension/even API key (e.g. a separate billing
 * project for the experiment). Returns `null` (not a thrown error) when
 * AI_CANARY_EMBEDDING_PROVIDER is unset - selectEmbeddingProviderGroup()
 * already refuses to route any organization to canary in that case, but
 * this guards the factory itself against being called out of order.
 */
export function getCanaryEmbeddingProvider(): EmbeddingProvider | null {
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }
  if (!process.env[CANARY_ENV_NAMES.driverEnvVar]) {
    cachedProvider = null;
    return cachedProvider;
  }
  cachedProvider = buildEmbeddingProviderForDriver(CANARY_ENV_NAMES);
  return cachedProvider;
}

export function resetCanaryEmbeddingProviderCacheForTests(): void {
  cachedProvider = undefined;
}
