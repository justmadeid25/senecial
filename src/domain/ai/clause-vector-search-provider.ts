/**
 * §Phase 12.1 Part 8 - the abstraction hybrid search, findSimilarClauses,
 * conversation retrieval, AI review evidence retrieval, and the
 * evaluation CLI all go through instead of directly querying embeddings -
 * `PgVectorClauseSearchProvider` (real DB-native `<=>` ANN search) and
 * `ApplicationCosineClauseSearchProvider` (the pre-existing in-process
 * cosine fallback) both implement this same contract, so callers never
 * know or care which one actually ran a given search.
 */
export interface ClauseVectorSearchCandidate {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  /** Cosine SIMILARITY (0..1, higher is better) - never a raw pgvector distance; PgVectorClauseSearchProvider converts via vector-distance.ts before returning. */
  vectorScore: number;
}

export interface ClauseVectorSearchParams {
  organizationId: string;
  queryVector: number[];
  embeddingProvider: string;
  embeddingModel: string;
  topK: number;
  /** §AI 상담 개편 - when set, restricts candidates to this one contract (still nested inside the organizationId scope, never a substitute for it). */
  contractId?: string;
}

export interface ClauseVectorSearchProvider {
  readonly providerName: "pgvector" | "application";
  search(params: ClauseVectorSearchParams): Promise<ClauseVectorSearchCandidate[]>;
}
