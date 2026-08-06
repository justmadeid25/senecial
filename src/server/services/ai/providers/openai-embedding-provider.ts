import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import type {
  EmbeddingBatchItemResult,
  EmbeddingBatchResult,
  EmbeddingCallOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from "@/domain/ai/embedding-provider";
import { classifyProviderHttpStatus, PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";
import type { RetryPolicyConfig } from "@/domain/ai/retry-policy";
import { isFiniteVector } from "@/domain/ai/vector-validation";

import { executeWithResilience } from "./execute-with-resilience";

/**
 * §Phase 13 Part C - OpenAI does not publish a hard floor for the
 * `dimensions` truncation parameter, but 256 is the smallest value OpenAI
 * itself benchmarks in the text-embedding-3 launch post (matching or
 * beating text-embedding-ada-002's full 1536 dimensions on MTEB) - never
 * an untested/arbitrary value.
 */
export const OPENAI_EMBEDDING_DEFAULT_MODEL = "text-embedding-3-small";

/** OpenAI's documented `input` array limit is far higher, but a smaller client-side cap keeps any single request's latency/blast-radius bounded - see run-embedding-backfill.ts, which chunks larger jobs into calls of this size. */
export const OPENAI_EMBEDDING_MAX_BATCH_SIZE = 96;

interface OpenAiEmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  dimension: number;
  timeoutMs: number;
  retryPolicy: RetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
}

interface OpenAiEmbeddingApiResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number };
  model?: string;
}

/**
 * Real (not stubbed) implementation of OpenAI's `/v1/embeddings` endpoint.
 * `dimensions` is always sent explicitly (never omitted) - see
 * get-embedding-provider.ts for why 256 is the recommended default (it
 * lets this provider populate `ClauseEmbedding.vectorNative`, a fixed
 * `vector(256)` column, with ZERO schema migration - Phase 13's chosen
 * "전략 C: 모델 dimension 고정" from docs/operations/ai-platform.md). A
 * different AI_EMBEDDING_DIMENSION value still works correctly, it just
 * relies on the `vector` Float[] application-cosine fallback path instead
 * (exactly like a not-yet-backfilled legacy row - see
 * clause-embedding-repository.ts's createLatestClauseEmbedding()).
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "openai";

  constructor(
    readonly modelName: string,
    private readonly config: OpenAiEmbeddingConfig
  ) {}

  get dimension(): number {
    return this.config.dimension;
  }

  private buildUrl(): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/embeddings`;
  }

  private buildHeaders(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` };
  }

  private async callApi(input: string | string[], options: EmbeddingCallOptions | undefined): Promise<OpenAiEmbeddingApiResponse> {
    return executeWithResilience({
      providerName: this.providerName,
      operation: "embedding",
      circuitBreaker: this.config.circuitBreaker,
      timeoutMs: this.config.timeoutMs,
      retryPolicy: this.config.retryPolicy,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId,
      attempt: async (signal) => {
        const response = await fetch(this.buildUrl(), {
          method: "POST",
          headers: this.buildHeaders(),
          signal,
          body: JSON.stringify({ model: this.modelName, input, dimensions: this.config.dimension }),
        });
        if (!response.ok) {
          throw new ProviderError({
            errorCode: classifyProviderHttpStatus(response.status),
            providerName: this.providerName,
            httpStatus: response.status,
          });
        }
        let body: OpenAiEmbeddingApiResponse;
        try {
          body = (await response.json()) as OpenAiEmbeddingApiResponse;
        } catch (parseError) {
          throw new ProviderError({
            errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
            providerName: this.providerName,
            cause: parseError,
          });
        }
        if (!Array.isArray(body.data) || body.data.length === 0) {
          throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID, providerName: this.providerName });
        }
        return body;
      },
    });
  }

  private toResult(embedding: number[], usage?: OpenAiEmbeddingApiResponse["usage"]): EmbeddingResult {
    if (embedding.length !== this.config.dimension || !isFiniteVector(embedding)) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID, providerName: this.providerName });
    }
    return {
      vector: embedding,
      dimension: this.config.dimension,
      usage: usage?.prompt_tokens !== undefined ? { inputTokens: usage.prompt_tokens } : undefined,
    };
  }

  async generateEmbedding(text: string, options?: EmbeddingCallOptions): Promise<EmbeddingResult> {
    const body = await this.callApi(text, options);
    const first = body.data[0];
    if (!first) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID, providerName: this.providerName });
    }
    return this.toResult(first.embedding, body.usage);
  }

  /**
   * §Phase 13 Part C (§7) - OpenAI's batch endpoint accepts an `input`
   * array in one HTTP round trip. Response ordering is verified explicitly
   * via each item's own `index` field (never assumed to match request
   * order) - see EmbeddingBatchItemResult's own docstring.
   */
  async generateEmbeddings(texts: string[], options?: EmbeddingCallOptions): Promise<EmbeddingBatchResult> {
    if (texts.length === 0) {
      return { results: [] };
    }
    if (texts.length > OPENAI_EMBEDDING_MAX_BATCH_SIZE) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    const body = await this.callApi(texts, options);
    if (body.data.length !== texts.length) {
      throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID, providerName: this.providerName });
    }
    const perItemTokens =
      body.usage?.prompt_tokens !== undefined ? Math.ceil(body.usage.prompt_tokens / texts.length) : undefined;
    const results: EmbeddingBatchItemResult[] = body.data.map((item) => ({
      ...this.toResult(item.embedding, perItemTokens !== undefined ? { prompt_tokens: perItemTokens } : undefined),
      index: item.index,
    }));
    return { results };
  }
}
