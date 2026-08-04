import type { ClauseVectorSearchCandidate, ClauseVectorSearchParams } from "@/domain/ai/clause-vector-search-provider";
import { getLogger } from "@/server/logging";
import { recordDependencyLatency, recordVectorCandidateCount, recordVectorFallback, recordVectorSearchError } from "@/server/monitoring/metrics";
import { ApplicationCosineClauseSearchProvider } from "@/server/services/ai/vector-search/application-cosine-clause-search-provider";
import { getClauseVectorSearchProvider } from "@/server/services/ai/vector-search/get-clause-vector-search-provider";

/**
 * §Phase 12.1 Part 12 (Fallback 정책) - the single entry point every
 * caller (hybrid search, similar clause, RAG retrieval, evaluation CLI)
 * uses instead of calling a provider directly, so this policy is enforced
 * exactly once. If the configured provider is `pgvector` and the query
 * itself fails (extension missing, vector column absent, etc.), the
 * DEFAULT behavior is to let the failure propagate - never a silent
 * per-request degrade that would mask a real production problem. Only
 * with `AI_VECTOR_SEARCH_ALLOW_FALLBACK=true` explicitly set does a
 * failure degrade to the application cosine provider instead, and every
 * such fallback is both logged (structured warning, no clause text/query
 * text in the log fields) and counted (`recordVectorFallback()`).
 */
export async function searchClauseVectors(params: ClauseVectorSearchParams): Promise<ClauseVectorSearchCandidate[]> {
  const provider = getClauseVectorSearchProvider();
  const start = performance.now();

  try {
    const results = await provider.search(params);
    recordDependencyLatency("vectorSearch", performance.now() - start);
    recordVectorCandidateCount(results.length);
    return results;
  } catch (error) {
    if (provider.providerName !== "pgvector" || process.env.AI_VECTOR_SEARCH_ALLOW_FALLBACK !== "true") {
      recordVectorSearchError();
      throw error;
    }

    getLogger().warn("vector_search.fallback_to_application", {
      errorCode: error instanceof Error ? error.name : "UnknownError",
    });
    recordVectorFallback();

    const fallbackStart = performance.now();
    const results = await new ApplicationCosineClauseSearchProvider().search(params);
    recordDependencyLatency("vectorSearch", performance.now() - fallbackStart);
    recordVectorCandidateCount(results.length);
    return results;
  }
}
