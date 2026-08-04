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
});
