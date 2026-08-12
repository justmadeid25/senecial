import type {
  DocumentChunkVectorSearchCandidate,
  DocumentChunkVectorSearchParams,
} from "@/domain/ai/document-chunk-vector-search-provider";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import { getLogger } from "@/server/logging";
import {
  recordDependencyLatency,
  recordLatencyBudgetExceeded,
  recordVectorCandidateCount,
  recordVectorFallback,
  recordVectorSearchError,
} from "@/server/monitoring/metrics";
import { ApplicationCosineDocumentChunkSearchProvider } from "@/server/services/ai/vector-search/application-cosine-document-chunk-search-provider";
import { getDocumentChunkVectorSearchProvider } from "@/server/services/ai/vector-search/get-document-chunk-vector-search-provider";

function checkVectorSearchBudget(durationMs: number): void {
  if (exceedsLatencyBudget("vectorSearch", durationMs, false)) {
    recordLatencyBudgetExceeded("vectorSearch");
  }
}

/**
 * §Phase 14.1 - mirrors search-clause-vectors.ts's searchClauseVectors()
 * exactly, for ContractDocumentChunk: same fallback policy
 * (AI_VECTOR_SEARCH_ALLOW_FALLBACK, same logging/metrics shape), reusing
 * the identical metric names (a single dashboard shows clause and chunk
 * vector search load/fallback together, which is the correct picture -
 * they share the same underlying pgvector infrastructure and failure
 * modes).
 */
export async function searchDocumentChunkVectors(
  params: DocumentChunkVectorSearchParams
): Promise<DocumentChunkVectorSearchCandidate[]> {
  const provider = getDocumentChunkVectorSearchProvider();
  const start = performance.now();

  try {
    const results = await provider.search(params);
    const durationMs = performance.now() - start;
    recordDependencyLatency("vectorSearch", durationMs);
    checkVectorSearchBudget(durationMs);
    recordVectorCandidateCount(results.length);
    return results;
  } catch (error) {
    if (provider.providerName !== "pgvector" || process.env.AI_VECTOR_SEARCH_ALLOW_FALLBACK !== "true") {
      recordVectorSearchError();
      throw error;
    }

    getLogger().warn("chunk_vector_search.fallback_to_application", {
      errorCode: error instanceof Error ? error.name : "UnknownError",
    });
    recordVectorFallback();

    const fallbackStart = performance.now();
    const results = await new ApplicationCosineDocumentChunkSearchProvider().search(params);
    const fallbackDurationMs = performance.now() - fallbackStart;
    recordDependencyLatency("vectorSearch", fallbackDurationMs);
    checkVectorSearchBudget(fallbackDurationMs);
    recordVectorCandidateCount(results.length);
    return results;
  }
}
