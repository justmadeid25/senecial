import { describe, expect, it } from "vitest";

import { buildRetrievalCacheKey, type RetrievalCacheKeyParams } from "@/domain/ai/retrieval-cache-key";

function baseParams(overrides: Partial<RetrievalCacheKeyParams> = {}): RetrievalCacheKeyParams {
  return {
    vectorSearchProviderName: "pgvector",
    embeddingProviderName: "development",
    embeddingModelName: "hashing-trick-v1",
    embeddingDimension: 256,
    organizationId: "org-1",
    question: "계약을 해지하려면 어떻게 해야 하나요?",
    topK: 10,
    ...overrides,
  };
}

describe("buildRetrievalCacheKey (Phase 12.1 §15/§20 - provider-specific cache key)", () => {
  it("is deterministic for identical inputs", () => {
    expect(buildRetrievalCacheKey(baseParams())).toBe(buildRetrievalCacheKey(baseParams()));
  });

  it("produces a different key for pgvector vs application, all else equal - the core requirement of §15", () => {
    const pgvectorKey = buildRetrievalCacheKey(baseParams({ vectorSearchProviderName: "pgvector" }));
    const applicationKey = buildRetrievalCacheKey(baseParams({ vectorSearchProviderName: "application" }));
    expect(pgvectorKey).not.toBe(applicationKey);
  });

  it("produces a different key for a different embedding provider", () => {
    const a = buildRetrievalCacheKey(baseParams({ embeddingProviderName: "development" }));
    const b = buildRetrievalCacheKey(baseParams({ embeddingProviderName: "openai" }));
    expect(a).not.toBe(b);
  });

  it("produces a different key for a different embedding model", () => {
    const a = buildRetrievalCacheKey(baseParams({ embeddingModelName: "hashing-trick-v1" }));
    const b = buildRetrievalCacheKey(baseParams({ embeddingModelName: "text-embedding-3-small" }));
    expect(a).not.toBe(b);
  });

  it("produces a different key for a different embedding dimension", () => {
    const a = buildRetrievalCacheKey(baseParams({ embeddingDimension: 256 }));
    const b = buildRetrievalCacheKey(baseParams({ embeddingDimension: 1536 }));
    expect(a).not.toBe(b);
  });

  it("produces a different key for a different organization", () => {
    const a = buildRetrievalCacheKey(baseParams({ organizationId: "org-1" }));
    const b = buildRetrievalCacheKey(baseParams({ organizationId: "org-2" }));
    expect(a).not.toBe(b);
  });

  it("produces a different key for a different question or topK", () => {
    const a = buildRetrievalCacheKey(baseParams({ question: "질문 A" }));
    const b = buildRetrievalCacheKey(baseParams({ question: "질문 B" }));
    expect(a).not.toBe(b);

    const c = buildRetrievalCacheKey(baseParams({ topK: 5 }));
    const d = buildRetrievalCacheKey(baseParams({ topK: 10 }));
    expect(c).not.toBe(d);
  });

  it("embeds the current SEARCH_WEIGHT_VERSION, so a future weight-version bump changes every existing key", async () => {
    const { SEARCH_WEIGHT_VERSION } = await import("@/domain/ai/hybrid-search-scoring");
    expect(buildRetrievalCacheKey(baseParams())).toContain(`w${SEARCH_WEIGHT_VERSION}`);
  });

  it("§Phase 12.2 §34 - embeds PROMPT_TEMPLATE_VERSION and CITATION_VALIDATOR_VERSION too", async () => {
    const { PROMPT_TEMPLATE_VERSION } = await import("@/domain/ai/prompt-builder");
    const { CITATION_VALIDATOR_VERSION } = await import("@/domain/ai/citation-required");
    const key = buildRetrievalCacheKey(baseParams());
    expect(key).toContain(`p${PROMPT_TEMPLATE_VERSION}`);
    expect(key).toContain(`c${CITATION_VALIDATOR_VERSION}`);
  });
});

/**
 * §AI 상담 개편 - regression coverage for the contractId fragment added to
 * buildRetrievalCacheKey() (see that function's own docstring). A cache
 * key collision here would mean a contract-scoped retrieval result could
 * be served back for an unscoped (or differently-scoped) request -
 * exactly the leak hybridSearchClauses/hybridSearchDocumentChunks rely on
 * this function to prevent.
 */
describe("buildRetrievalCacheKey - contractId isolation (§AI 상담 개편)", () => {
  it("an unscoped key and a contract-scoped key (same org/question/topK) are different", () => {
    const unscoped = buildRetrievalCacheKey(baseParams());
    const scoped = buildRetrievalCacheKey(baseParams({ contractId: "contract-a" }));
    expect(scoped).not.toBe(unscoped);
  });

  it("two different contractIds (same org/question/topK) produce different keys", () => {
    const keyA = buildRetrievalCacheKey(baseParams({ contractId: "contract-a" }));
    const keyB = buildRetrievalCacheKey(baseParams({ contractId: "contract-b" }));
    expect(keyA).not.toBe(keyB);
  });

  it("omitting contractId and passing contractId: undefined produce the identical key (both mean 'unscoped')", () => {
    const omitted = buildRetrievalCacheKey(baseParams());
    const explicitUndefined = buildRetrievalCacheKey(baseParams({ contractId: undefined }));
    expect(explicitUndefined).toBe(omitted);
  });

  it("is deterministic - the same params (including contractId) always build the same key", () => {
    const params = baseParams({ contractId: "contract-a" });
    expect(buildRetrievalCacheKey(params)).toBe(buildRetrievalCacheKey(params));
  });

  it("still varies with every other pre-existing fragment when contractId is held constant (no regression from adding contractId)", () => {
    const params = baseParams({ contractId: "contract-a" });
    const baseline = buildRetrievalCacheKey(params);

    expect(buildRetrievalCacheKey({ ...params, vectorSearchProviderName: "application" })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, embeddingProviderName: "openai" })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, embeddingModelName: "text-embedding-3-small" })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, embeddingDimension: 1536 })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, organizationId: "org-2" })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, question: "다른 질문입니다" })).not.toBe(baseline);
    expect(buildRetrievalCacheKey({ ...params, topK: 5 })).not.toBe(baseline);
  });
});
