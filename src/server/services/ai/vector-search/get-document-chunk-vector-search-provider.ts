import type { DocumentChunkVectorSearchProvider } from "@/domain/ai/document-chunk-vector-search-provider";

import { ApplicationCosineDocumentChunkSearchProvider } from "./application-cosine-document-chunk-search-provider";
import { PgVectorDocumentChunkSearchProvider } from "./pgvector-document-chunk-search-provider";

let cachedProvider: DocumentChunkVectorSearchProvider | undefined;

/**
 * §Phase 14.1 - mirrors get-clause-vector-search-provider.ts exactly,
 * deliberately reusing the SAME `AI_VECTOR_SEARCH_PROVIDER` env var
 * rather than a parallel knob - clause and chunk vector search share one
 * "pgvector vs application" operational decision, not two.
 */
export function getDocumentChunkVectorSearchProvider(): DocumentChunkVectorSearchProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_VECTOR_SEARCH_PROVIDER ?? "pgvector";

  switch (driver) {
    case "pgvector":
      cachedProvider = new PgVectorDocumentChunkSearchProvider();
      return cachedProvider;
    case "application":
      cachedProvider = new ApplicationCosineDocumentChunkSearchProvider();
      return cachedProvider;
    default:
      throw new Error(`지원하지 않는 AI_VECTOR_SEARCH_PROVIDER 입니다: ${driver}`);
  }
}

/** Same rationale as resetClauseVectorSearchProviderCache() - exported for the evaluation CLI's --compare mode. */
export function resetDocumentChunkVectorSearchProviderCache(): void {
  cachedProvider = undefined;
}
