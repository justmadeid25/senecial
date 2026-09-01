/**
 * §Phase 14.1 - mirrors domain/ai/clause-vector-search-provider.ts exactly,
 * for ContractDocumentChunk. hybridSearchClauses (extended for dual
 * retrieval) goes through this abstraction instead of directly querying
 * embeddings, so the pgvector/application-cosine choice for chunks stays
 * interchangeable exactly like it already is for clauses.
 */
export interface DocumentChunkVectorSearchCandidate {
  chunkId: string;
  contractId: string;
  contractTitle: string;
  chunkIndex: number;
  headingContext: string | null;
  text: string;
  startOffset: number;
  endOffset: number;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  /** Cosine SIMILARITY (0..1, higher is better) - never a raw pgvector distance. */
  vectorScore: number;
}

export interface DocumentChunkVectorSearchParams {
  organizationId: string;
  queryVector: number[];
  embeddingProvider: string;
  embeddingModel: string;
  topK: number;
  /** §AI 상담 개편 - when set, restricts candidates to this one contract (still nested inside the organizationId scope, never a substitute for it). */
  contractId?: string;
}

export interface DocumentChunkVectorSearchProvider {
  readonly providerName: "pgvector" | "application";
  search(params: DocumentChunkVectorSearchParams): Promise<DocumentChunkVectorSearchCandidate[]>;
}
