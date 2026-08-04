import type { EmbeddingProvider, EmbeddingResult } from "@/domain/ai/embedding-provider";
import { computeHashingTrickEmbedding, HASHING_TRICK_DEFAULT_DIMENSION } from "@/domain/ai/hashing-trick-embedding";

/**
 * !!! DEVELOPMENT ONLY - NOT a trained neural embedding model !!!
 *
 * A real (not fake/random) implementation of the hashing-trick feature
 * embedding (see hashing-trick-embedding.ts's docstring for why this is
 * genuinely meaningful, not a placeholder) - synchronous, in-process, and
 * free, which is exactly why it is useful for development/CI/E2E without
 * a real embedding API credential. A production deployment should
 * replace this with a real neural embedding provider (see
 * services/ai/providers/) for actual semantic (not just lexical/n-gram)
 * similarity - see get-embedding-provider.ts, which refuses this class in
 * production unless explicitly overridden.
 */
export class DeterministicDevelopmentEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "development";
  readonly modelName = "hashing-trick-v1";
  readonly dimension = HASHING_TRICK_DEFAULT_DIMENSION;

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    return {
      vector: computeHashingTrickEmbedding(text, this.dimension),
      dimension: this.dimension,
    };
  }
}
