import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClauseVectorSearchCandidate, ClauseVectorSearchProvider } from "@/domain/ai/clause-vector-search-provider";

const searchMock = vi.fn();
const applicationSearchMock = vi.fn();
let configuredProviderName: "pgvector" | "application" = "pgvector";

vi.mock("@/server/services/ai/vector-search/get-clause-vector-search-provider", () => ({
  getClauseVectorSearchProvider: (): ClauseVectorSearchProvider => ({
    get providerName() {
      return configuredProviderName;
    },
    search: searchMock,
  }),
}));

vi.mock("@/server/services/ai/vector-search/application-cosine-clause-search-provider", () => ({
  ApplicationCosineClauseSearchProvider: class {
    providerName = "application" as const;
    search = applicationSearchMock;
  },
}));

const { searchClauseVectors } = await import("@/features/ai/server/search-clause-vectors");

const SAMPLE_PARAMS = {
  organizationId: "org-1",
  queryVector: [1, 2, 3],
  embeddingProvider: "development",
  embeddingModel: "hashing-trick-v1",
  topK: 5,
};

const SAMPLE_RESULTS: ClauseVectorSearchCandidate[] = [
  {
    contractClauseId: "clause-1",
    contractId: "contract-1",
    contractTitle: "테스트 계약",
    clauseNumber: "제1조",
    title: null,
    text: "테스트 조항",
    vectorScore: 0.9,
  },
];

describe("searchClauseVectors fallback policy (Phase 12.1 §12/§20)", () => {
  beforeEach(() => {
    configuredProviderName = "pgvector";
    searchMock.mockReset();
    applicationSearchMock.mockReset();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured provider's results directly on success (no fallback invoked)", async () => {
    searchMock.mockResolvedValue(SAMPLE_RESULTS);
    const results = await searchClauseVectors(SAMPLE_PARAMS);
    expect(results).toEqual(SAMPLE_RESULTS);
    expect(applicationSearchMock).not.toHaveBeenCalled();
  });

  it("re-throws (never silently falls back) when pgvector fails and AI_VECTOR_SEARCH_ALLOW_FALLBACK is unset", async () => {
    searchMock.mockRejectedValue(new Error("extension \"vector\" does not exist"));
    await expect(searchClauseVectors(SAMPLE_PARAMS)).rejects.toThrow('extension "vector" does not exist');
    expect(applicationSearchMock).not.toHaveBeenCalled();
  });

  it("re-throws even with the allow-fallback flag set to a non-'true' value", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_ALLOW_FALLBACK", "false");
    searchMock.mockRejectedValue(new Error("connection refused"));
    await expect(searchClauseVectors(SAMPLE_PARAMS)).rejects.toThrow("connection refused");
    expect(applicationSearchMock).not.toHaveBeenCalled();
  });

  it("falls back to the application provider ONLY when pgvector fails AND the flag is explicitly 'true'", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_ALLOW_FALLBACK", "true");
    searchMock.mockRejectedValue(new Error("extension \"vector\" does not exist"));
    applicationSearchMock.mockResolvedValue(SAMPLE_RESULTS);

    const results = await searchClauseVectors(SAMPLE_PARAMS);
    expect(results).toEqual(SAMPLE_RESULTS);
    expect(applicationSearchMock).toHaveBeenCalledWith(SAMPLE_PARAMS);
  });

  it("never falls back when the configured provider is already 'application' (nothing to fall back to)", async () => {
    configuredProviderName = "application";
    vi.stubEnv("AI_VECTOR_SEARCH_ALLOW_FALLBACK", "true");
    searchMock.mockRejectedValue(new Error("some application-path error"));

    await expect(searchClauseVectors(SAMPLE_PARAMS)).rejects.toThrow("some application-path error");
    expect(applicationSearchMock).not.toHaveBeenCalled();
  });
});
