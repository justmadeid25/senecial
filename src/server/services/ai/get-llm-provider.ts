import type { LlmProvider } from "@/domain/ai/llm-provider";
import {
  assertNonEmptyModel,
  assertSafeProviderBaseUrl,
  parsePositiveIntEnv,
  parseRetriesEnv,
  parseTimeoutMsEnv,
} from "@/domain/ai/provider-config-validation";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";

import { getAiCircuitBreaker } from "./circuit-breaker/get-ai-circuit-breaker";
import { DeterministicDevelopmentLlmProvider } from "./deterministic-development-llm-provider";
import { AnthropicLlmProvider } from "./providers/anthropic-llm-provider";
import { FallbackLlmProvider } from "./providers/fallback-llm-provider";
import { GeminiLlmProvider } from "./providers/gemini-llm-provider";
import { OpenAiCompatibleLlmProvider } from "./providers/openai-compatible-llm-provider";
import { OPENAI_LLM_DEFAULT_MODEL, OpenAiResponsesLlmProvider } from "./providers/openai-responses-llm-provider";

let cachedProvider: LlmProvider | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`AI_LLM_PROVIDER 설정에 필요한 환경변수 ${name}이(가) 설정되지 않았습니다.`);
  }
  return value;
}

export interface SharedLlmRuntimeConfig {
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  defaultMaxOutputTokens?: number;
  defaultTemperature?: number;
}

export function loadSharedRuntimeConfig(): SharedLlmRuntimeConfig {
  const timeoutMs = parseTimeoutMsEnv(process.env.AI_LLM_TIMEOUT_MS, 60_000, "AI_LLM_TIMEOUT_MS");
  const maxRetries = parseRetriesEnv(process.env.AI_LLM_MAX_RETRIES, 2, "AI_LLM_MAX_RETRIES");
  const defaultMaxOutputTokens = process.env.AI_LLM_MAX_OUTPUT_TOKENS
    ? parsePositiveIntEnv(process.env.AI_LLM_MAX_OUTPUT_TOKENS, 2048, "AI_LLM_MAX_OUTPUT_TOKENS")
    : undefined;
  const rawTemperature = process.env.AI_LLM_TEMPERATURE;
  const defaultTemperature = rawTemperature !== undefined ? Number(rawTemperature) : undefined;
  return {
    timeoutMs,
    retryPolicy: { maxRetries, baseDelayMs: 500, maxDelayMs: 4000 },
    defaultMaxOutputTokens,
    defaultTemperature,
  };
}

/**
 * §Phase 13 Part D/E - builds ONE named driver's provider instance. Used
 * for both the primary (AI_LLM_PROVIDER/AI_LLM_MODEL) and, when
 * AI_PROVIDER_FAILOVER_ENABLED=true, the secondary
 * (AI_SECONDARY_LLM_PROVIDER/AI_SECONDARY_LLM_MODEL) - the same
 * validation/construction logic applies to both, so a secondary can never
 * silently skip the checks the primary is held to.
 */
export function buildLlmProviderForDriver(params: {
  driver: string;
  modelEnvVar: string;
  apiKeyEnvVar: string;
  isProduction: boolean;
  shared: SharedLlmRuntimeConfig;
}): LlmProvider {
  const { driver, modelEnvVar, apiKeyEnvVar, isProduction, shared } = params;
  const circuitBreaker = getAiCircuitBreaker();

  switch (driver) {
    case "development": {
      if (isProduction && process.env.ALLOW_DEVELOPMENT_AI_PROVIDER !== "true") {
        throw new Error(
          "AI_LLM_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 LLM 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_AI_PROVIDER=true를 설정하십시오."
        );
      }
      return new DeterministicDevelopmentLlmProvider();
    }
    case "openai": {
      const apiKey = requireEnv(apiKeyEnvVar);
      const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
      assertSafeProviderBaseUrl(baseUrl, "OPENAI_BASE_URL", isProduction);
      const model = process.env[modelEnvVar] ?? OPENAI_LLM_DEFAULT_MODEL;
      assertNonEmptyModel(model, modelEnvVar);
      return new OpenAiResponsesLlmProvider(model, {
        apiKey,
        baseUrl,
        timeoutMs: shared.timeoutMs,
        retryPolicy: shared.retryPolicy,
        circuitBreaker,
        defaultMaxOutputTokens: shared.defaultMaxOutputTokens,
        defaultTemperature: shared.defaultTemperature,
      });
    }
    case "azure-openai": {
      const apiKey = requireEnv("AZURE_OPENAI_API_KEY");
      const baseUrl = requireEnv("AZURE_OPENAI_ENDPOINT");
      assertSafeProviderBaseUrl(baseUrl, "AZURE_OPENAI_ENDPOINT", isProduction);
      const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT");
      return new OpenAiCompatibleLlmProvider("azure-openai", deployment, {
        baseUrl: `${baseUrl.replace(/\/$/, "")}/openai/deployments/${deployment}`,
        apiKey,
        authHeaderStyle: "api-key",
        extraQueryParams: { "api-version": process.env.AZURE_OPENAI_API_VERSION ?? "2024-06-01" },
        timeoutMs: shared.timeoutMs,
        retryPolicy: shared.retryPolicy,
        circuitBreaker,
        defaultMaxOutputTokens: shared.defaultMaxOutputTokens,
        defaultTemperature: shared.defaultTemperature,
      });
    }
    case "ollama": {
      const model = process.env[modelEnvVar] ?? "llama3";
      const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
      // Ollama is expected to run locally/in-network - never held to the HTTPS guard the way a real external provider is.
      return new OpenAiCompatibleLlmProvider("ollama", model, {
        baseUrl,
        apiKey: process.env.OLLAMA_API_KEY,
        authHeaderStyle: "bearer",
        timeoutMs: shared.timeoutMs,
        retryPolicy: shared.retryPolicy,
        circuitBreaker,
        defaultMaxOutputTokens: shared.defaultMaxOutputTokens,
        defaultTemperature: shared.defaultTemperature,
      });
    }
    case "anthropic": {
      const apiKey = requireEnv(apiKeyEnvVar);
      const model = process.env[modelEnvVar] ?? "claude-sonnet-5";
      return new AnthropicLlmProvider(model, {
        apiKey,
        timeoutMs: shared.timeoutMs,
        retryPolicy: shared.retryPolicy,
        circuitBreaker,
        maxTokens: shared.defaultMaxOutputTokens,
      });
    }
    case "gemini": {
      const apiKey = requireEnv(apiKeyEnvVar);
      const model = process.env[modelEnvVar] ?? "gemini-2.0-flash";
      return new GeminiLlmProvider(model, {
        apiKey,
        timeoutMs: shared.timeoutMs,
        retryPolicy: shared.retryPolicy,
        circuitBreaker,
        defaultMaxOutputTokens: shared.defaultMaxOutputTokens,
        defaultTemperature: shared.defaultTemperature,
      });
    }
    default:
      throw new Error(`지원하지 않는 LLM provider 입니다: ${driver}`);
  }
}

/**
 * Returns the configured LLM provider. `AI_LLM_PROVIDER=development` (the
 * default) is the real (not fake/canned) extractive Development provider -
 * not a trained language model - and is refused in production unless
 * explicitly overridden, mirroring getEmbeddingProvider()'s identical
 * pattern.
 *
 * §Phase 13 Part D/E/F - `openai` now uses the Responses API
 * (OpenAiResponsesLlmProvider), every real provider routes through
 * executeWithResilience() (timeout/retry/circuit-breaker), and when
 * `AI_PROVIDER_FAILOVER_ENABLED=true` the returned provider is wrapped in
 * FallbackLlmProvider with a secondary driver
 * (AI_SECONDARY_LLM_PROVIDER/AI_SECONDARY_LLM_MODEL/
 * AI_SECONDARY_LLM_API_KEY). None of the five real providers has been
 * live-network-verified in this session (no API key/local Ollama available
 * in this sandbox) - see docs/operations/ai-platform.md.
 */
export function getLlmProvider(): LlmProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_LLM_PROVIDER ?? "development";
  const isProduction = process.env.NODE_ENV === "production";
  const shared = loadSharedRuntimeConfig();

  const primary = buildLlmProviderForDriver({
    driver,
    modelEnvVar: "AI_LLM_MODEL",
    apiKeyEnvVar: apiKeyEnvVarForDriver(driver),
    isProduction,
    shared,
  });

  if (process.env.AI_PROVIDER_FAILOVER_ENABLED === "true") {
    const secondaryDriver = requireEnv("AI_SECONDARY_LLM_PROVIDER");
    if (secondaryDriver === driver) {
      throw new Error("AI_SECONDARY_LLM_PROVIDER는 AI_LLM_PROVIDER와 동일한 provider로 설정할 수 없습니다.");
    }
    const secondary = buildLlmProviderForDriver({
      driver: secondaryDriver,
      modelEnvVar: "AI_SECONDARY_LLM_MODEL",
      apiKeyEnvVar: secondaryApiKeyEnvVarForDriver(secondaryDriver),
      isProduction,
      shared,
    });
    cachedProvider = new FallbackLlmProvider(primary, secondary, getAiCircuitBreaker());
    return cachedProvider;
  }

  cachedProvider = primary;
  return cachedProvider;
}

/** development/ollama need no API key at all; every other driver reads its own conventional env var name (matches the existing per-provider naming this factory already used before Phase 13). */
function apiKeyEnvVarForDriver(driver: string): string {
  switch (driver) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    default:
      return "";
  }
}

/**
 * §Phase 13 Part B - the secondary provider gets its OWN credential var
 * (AI_SECONDARY_LLM_API_KEY) rather than silently reusing the primary's -
 * a genuine failover deployment often uses a different account/org
 * (e.g. Anthropic as secondary while OpenAI is primary), and reusing the
 * primary's key would make a secondary "openai" driver indistinguishable
 * from the primary during an auth-scoped outage.
 */
function secondaryApiKeyEnvVarForDriver(driver: string): string {
  if (driver === "development" || driver === "ollama") {
    return "";
  }
  return "AI_SECONDARY_LLM_API_KEY";
}

/** Test-only escape hatch - mirrors resetEmbeddingProviderCacheForTests(). */
export function resetLlmProviderCacheForTests(): void {
  cachedProvider = undefined;
}
