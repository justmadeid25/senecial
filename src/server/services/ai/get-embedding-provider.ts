import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import {
  assertNonEmptyModel,
  assertSafeProviderBaseUrl,
  parsePositiveIntEnv,
  parseRetriesEnv,
  parseTimeoutMsEnv,
} from "@/domain/ai/provider-config-validation";

import { getAiCircuitBreaker } from "./circuit-breaker/get-ai-circuit-breaker";
import { DeterministicDevelopmentEmbeddingProvider } from "./deterministic-development-embedding-provider";
import {
  OPENAI_EMBEDDING_DEFAULT_MODEL,
  OPENAI_EMBEDDING_NATIVE_DIMENSIONS,
  OpenAiEmbeddingProvider,
} from "./providers/openai-embedding-provider";

let cachedProvider: EmbeddingProvider | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`AI_EMBEDDING_PROVIDER 설정에 필요한 환경변수 ${name}이(가) 설정되지 않았습니다.`);
  }
  return value;
}

/**
 * §Phase 13 Part C (§8) - the FIXED width of ClauseEmbedding.vectorNative
 * (`vector(256)`, see domain/ai/vector-search-config.ts's
 * VECTOR_NATIVE_DIMENSION). Defaulting AI_EMBEDDING_DIMENSION to 256 -
 * rather than OpenAI's own native 1536 - is Phase 13's deliberate "전략 C:
 * 모델 dimension 고정" choice (docs/operations/ai-platform.md): OpenAI's
 * `dimensions` truncation parameter (Matryoshka representation learning)
 * lets text-embedding-3-small emit a real 256-dimension neural embedding
 * that slots directly into the EXISTING pgvector column with ZERO schema
 * migration, while still being a genuine trained model (not the
 * hashing-trick fallback). An operator who overrides this to a different
 * value still works correctly - see openai-embedding-provider.ts's own
 * docstring - it just relies on the `vector` Float[] application-cosine
 * path instead of the native pgvector index until a future migration
 * widens the column.
 */
export const DEFAULT_OPENAI_EMBEDDING_DIMENSION = 256;

interface EmbeddingDriverEnvNames {
  driverEnvVar: string;
  apiKeyEnvVar: string;
  baseUrlEnvVar: string;
  modelEnvVar: string;
  dimensionEnvVar: string;
  timeoutEnvVar: string;
  retriesEnvVar: string;
  allowDevOverrideEnvVar: string;
}

const PRIMARY_ENV_NAMES: EmbeddingDriverEnvNames = {
  driverEnvVar: "AI_EMBEDDING_PROVIDER",
  apiKeyEnvVar: "OPENAI_API_KEY",
  baseUrlEnvVar: "OPENAI_BASE_URL",
  modelEnvVar: "AI_EMBEDDING_MODEL",
  dimensionEnvVar: "AI_EMBEDDING_DIMENSION",
  timeoutEnvVar: "AI_EMBEDDING_TIMEOUT_MS",
  retriesEnvVar: "AI_EMBEDDING_MAX_RETRIES",
  allowDevOverrideEnvVar: "ALLOW_DEVELOPMENT_AI_PROVIDER",
};

/**
 * §Phase 13.1 Part 5/10 - builds ONE named driver's embedding provider
 * instance, parameterized by which env var names to read - shared by the
 * primary factory (getEmbeddingProvider(), PRIMARY_ENV_NAMES) and the
 * canary factory (get-canary-embedding-provider.ts, its own
 * AI_CANARY_EMBEDDING_* names) so both are held to the identical
 * validation. `dimensionEnvVar`'s value of literally "default" means
 * "use the model's full native dimension, no `dimensions` truncation
 * param" - see OPENAI_EMBEDDING_NATIVE_DIMENSIONS's own docstring; this is
 * a dimension-COMPARISON-only mode (§5), never the recommended production
 * default (256).
 */
export function buildEmbeddingProviderForDriver(names: EmbeddingDriverEnvNames): EmbeddingProvider {
  const driver = process.env[names.driverEnvVar] ?? "development";
  const isProduction = process.env.NODE_ENV === "production";

  switch (driver) {
    case "development": {
      if (isProduction && process.env[names.allowDevOverrideEnvVar] !== "true") {
        throw new Error(
          `${names.driverEnvVar}=development은 운영 환경에서 사용할 수 없습니다. 실제 임베딩 공급자를 연동하거나, ` +
            `위험을 감수하고 명시적으로 ${names.allowDevOverrideEnvVar}=true를 설정하십시오.`
        );
      }
      return new DeterministicDevelopmentEmbeddingProvider();
    }
    case "openai": {
      const apiKey = requireEnv(names.apiKeyEnvVar);
      const baseUrl = process.env[names.baseUrlEnvVar] ?? "https://api.openai.com/v1";
      assertSafeProviderBaseUrl(baseUrl, names.baseUrlEnvVar, isProduction);
      const model = process.env[names.modelEnvVar] ?? OPENAI_EMBEDDING_DEFAULT_MODEL;
      assertNonEmptyModel(model, names.modelEnvVar);
      const timeoutMs = parseTimeoutMsEnv(process.env[names.timeoutEnvVar], 15_000, names.timeoutEnvVar);
      const maxRetries = parseRetriesEnv(process.env[names.retriesEnvVar], 2, names.retriesEnvVar);

      const rawDimension = process.env[names.dimensionEnvVar];
      const omitDimensionsParam = rawDimension === "default";
      const dimension = omitDimensionsParam
        ? (OPENAI_EMBEDDING_NATIVE_DIMENSIONS[model] ??
          (() => {
            throw new Error(`${names.modelEnvVar}=${model}의 native dimension을 알 수 없습니다 - OPENAI_EMBEDDING_NATIVE_DIMENSIONS에 추가하십시오.`);
          })())
        : parsePositiveIntEnv(rawDimension, DEFAULT_OPENAI_EMBEDDING_DIMENSION, names.dimensionEnvVar);

      return new OpenAiEmbeddingProvider(model, {
        apiKey,
        baseUrl,
        dimension,
        omitDimensionsParam,
        timeoutMs,
        retryPolicy: { maxRetries, baseDelayMs: 500, maxDelayMs: 4000 },
        circuitBreaker: getAiCircuitBreaker(),
      });
    }
    default:
      throw new Error(`지원하지 않는 ${names.driverEnvVar} 입니다: ${driver}`);
  }
}

/**
 * Returns the configured (primary) embedding provider.
 * `AI_EMBEDDING_PROVIDER=development` (the default) is the real (not
 * random/fake) hashing-trick provider - not a trained neural embedding
 * model - and is refused in production unless explicitly overridden,
 * mirroring getContractFieldExtractionService()'s identical pattern for
 * the identical reason.
 *
 * §Phase 13 Part C - `openai` reuses OPENAI_API_KEY/OPENAI_BASE_URL (the
 * SAME credential the LLM provider factory reads - see get-llm-provider.ts)
 * rather than introducing a second, parallel `AI_EMBEDDING_API_KEY` for
 * what is, for the OpenAI/Azure-OpenAI recommended combo (Part 3), a
 * single account/key shared by both embedding and chat calls.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) {
    return cachedProvider;
  }
  cachedProvider = buildEmbeddingProviderForDriver(PRIMARY_ENV_NAMES);
  return cachedProvider;
}

/** Test-only escape hatch - mirrors the pattern other provider factories in this codebase would need if they had one (currently none do, since none are exercised across multiple configs within a single test file). */
export function resetEmbeddingProviderCacheForTests(): void {
  cachedProvider = undefined;
}
