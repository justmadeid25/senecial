import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";

import { DeterministicDevelopmentEmbeddingProvider } from "./deterministic-development-embedding-provider";

let cachedProvider: EmbeddingProvider | undefined;

/**
 * Returns the configured embedding provider.
 * `AI_EMBEDDING_PROVIDER=development` (the default) is the real (not
 * random/fake) hashing-trick provider - not a trained neural embedding
 * model - and is refused in production unless explicitly overridden,
 * mirroring getContractFieldExtractionService()'s identical pattern for
 * the identical reason.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_EMBEDDING_PROVIDER ?? "development";

  switch (driver) {
    case "development": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEVELOPMENT_AI_PROVIDER !== "true") {
        throw new Error(
          "AI_EMBEDDING_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 임베딩 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_AI_PROVIDER=true를 설정하십시오."
        );
      }
      cachedProvider = new DeterministicDevelopmentEmbeddingProvider();
      return cachedProvider;
    }
    default:
      throw new Error(`지원하지 않는 AI_EMBEDDING_PROVIDER 입니다: ${driver}`);
  }
}
