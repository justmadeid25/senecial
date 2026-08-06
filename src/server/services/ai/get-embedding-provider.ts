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
import { OPENAI_EMBEDDING_DEFAULT_MODEL, OpenAiEmbeddingProvider } from "./providers/openai-embedding-provider";

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
const DEFAULT_OPENAI_EMBEDDING_DIMENSION = 256;

/**
 * Returns the configured embedding provider.
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

  const driver = process.env.AI_EMBEDDING_PROVIDER ?? "development";
  const isProduction = process.env.NODE_ENV === "production";

  switch (driver) {
    case "development": {
      if (isProduction && process.env.ALLOW_DEVELOPMENT_AI_PROVIDER !== "true") {
        throw new Error(
          "AI_EMBEDDING_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 임베딩 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_AI_PROVIDER=true를 설정하십시오."
        );
      }
      cachedProvider = new DeterministicDevelopmentEmbeddingProvider();
      return cachedProvider;
    }
    case "openai": {
      const apiKey = requireEnv("OPENAI_API_KEY");
      const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
      assertSafeProviderBaseUrl(baseUrl, "OPENAI_BASE_URL", isProduction);
      const model = process.env.AI_EMBEDDING_MODEL ?? OPENAI_EMBEDDING_DEFAULT_MODEL;
      assertNonEmptyModel(model, "AI_EMBEDDING_MODEL");
      const dimension = parsePositiveIntEnv(
        process.env.AI_EMBEDDING_DIMENSION,
        DEFAULT_OPENAI_EMBEDDING_DIMENSION,
        "AI_EMBEDDING_DIMENSION"
      );
      const timeoutMs = parseTimeoutMsEnv(process.env.AI_EMBEDDING_TIMEOUT_MS, 15_000, "AI_EMBEDDING_TIMEOUT_MS");
      const maxRetries = parseRetriesEnv(process.env.AI_EMBEDDING_MAX_RETRIES, 2, "AI_EMBEDDING_MAX_RETRIES");

      cachedProvider = new OpenAiEmbeddingProvider(model, {
        apiKey,
        baseUrl,
        dimension,
        timeoutMs,
        retryPolicy: { maxRetries, baseDelayMs: 500, maxDelayMs: 4000 },
        circuitBreaker: getAiCircuitBreaker(),
      });
      return cachedProvider;
    }
    default:
      throw new Error(`지원하지 않는 AI_EMBEDDING_PROVIDER 입니다: ${driver}`);
  }
}

/** Test-only escape hatch - mirrors the pattern other provider factories in this codebase would need if they had one (currently none do, since none are exercised across multiple configs within a single test file). */
export function resetEmbeddingProviderCacheForTests(): void {
  cachedProvider = undefined;
}
