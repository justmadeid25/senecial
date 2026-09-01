import { cosineSimilarity } from "@/domain/ai/cosine-similarity";
import type {
  DocumentChunkVectorSearchCandidate,
  DocumentChunkVectorSearchParams,
  DocumentChunkVectorSearchProvider,
} from "@/domain/ai/document-chunk-vector-search-provider";
import { latestAuthoritativeExtractedDocumentIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { prisma } from "@/server/db/client";

/**
 * §Phase 14.1, revised §Phase 14.2 - mirrors ApplicationCosineClauseSearchProvider,
 * for ContractDocumentChunk. Same eligibility rules as the pgvector
 * provider: org-scoped, only live (non-deleted) contracts, only the
 * latest extraction per contract (ai-retrieval-freshness.ts), only the
 * current isLatest embedding, only rows matching the requested embedding
 * provider/model.
 */
export class ApplicationCosineDocumentChunkSearchProvider implements DocumentChunkVectorSearchProvider {
  readonly providerName = "application" as const;

  async search(params: DocumentChunkVectorSearchParams): Promise<DocumentChunkVectorSearchCandidate[]> {
    const eligibleDocumentIds = await latestAuthoritativeExtractedDocumentIdsForOrganization(params.organizationId);
    if (eligibleDocumentIds.length === 0) {
      return [];
    }

    const embeddings = await prisma.contractDocumentChunkEmbedding.findMany({
      where: {
        organizationId: params.organizationId,
        isLatest: true,
        provider: params.embeddingProvider,
        model: params.embeddingModel,
        chunk: {
          contract: { deletedAt: null },
          extractedDocumentId: { in: eligibleDocumentIds },
          ...(params.contractId ? { contractId: params.contractId } : {}),
        },
      },
      select: {
        chunkId: true,
        vector: true,
        chunk: {
          select: {
            contractId: true,
            chunkIndex: true,
            headingContext: true,
            text: true,
            startOffset: true,
            endOffset: true,
            sourcePageStart: true,
            sourcePageEnd: true,
            contract: { select: { title: true } },
          },
        },
      },
    });

    const scored: DocumentChunkVectorSearchCandidate[] = embeddings.map((row) => ({
      chunkId: row.chunkId,
      contractId: row.chunk.contractId,
      contractTitle: row.chunk.contract.title,
      chunkIndex: row.chunk.chunkIndex,
      headingContext: row.chunk.headingContext,
      text: row.chunk.text,
      startOffset: row.chunk.startOffset,
      endOffset: row.chunk.endOffset,
      sourcePageStart: row.chunk.sourcePageStart,
      sourcePageEnd: row.chunk.sourcePageEnd,
      vectorScore: cosineSimilarity(params.queryVector, row.vector),
    }));

    return scored.sort((a, b) => b.vectorScore - a.vectorScore).slice(0, params.topK);
  }
}
