import { cosineSimilarity } from "@/domain/ai/cosine-similarity";
import type {
  ClauseVectorSearchCandidate,
  ClauseVectorSearchParams,
  ClauseVectorSearchProvider,
} from "@/domain/ai/clause-vector-search-provider";
import { latestAuthoritativeClauseSegmentationJobIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { prisma } from "@/server/db/client";

/**
 * §Phase 12.1 Part 8, revised §Phase 14.2 - the pre-existing in-process
 * cosine fallback, refactored behind the ClauseVectorSearchProvider
 * contract so hybridSearchClauses/findSimilarClauses/etc. can use either
 * this or PgVectorClauseSearchProvider interchangeably. Same eligibility
 * rules as the pgvector provider (§9): org-scoped, only the latest ready
 * segmentation revision PER CONTRACT, only live (non-deleted) contracts,
 * only the current embeddingVersion, only rows matching the requested
 * embedding provider/model - reusing
 * latestAuthoritativeClauseSegmentationJobIdsForOrganization()
 * (ai-retrieval-freshness.ts) so this provider and PgVectorClauseSearchProvider
 * can never silently drift apart on eligibility and produce
 * non-comparable result sets.
 */
export class ApplicationCosineClauseSearchProvider implements ClauseVectorSearchProvider {
  readonly providerName = "application" as const;

  async search(params: ClauseVectorSearchParams): Promise<ClauseVectorSearchCandidate[]> {
    const eligibleJobIds = await latestAuthoritativeClauseSegmentationJobIdsForOrganization(params.organizationId);
    if (eligibleJobIds.length === 0) {
      return [];
    }

    const embeddings = await prisma.clauseEmbedding.findMany({
      where: {
        organizationId: params.organizationId,
        isLatest: true,
        provider: params.embeddingProvider,
        model: params.embeddingModel,
        contractClause: { segmentationJobId: { in: eligibleJobIds } },
      },
      select: {
        contractClauseId: true,
        vector: true,
        contractClause: {
          select: {
            contractId: true,
            clauseNumber: true,
            title: true,
            text: true,
            contract: { select: { title: true } },
          },
        },
      },
    });

    const scored: ClauseVectorSearchCandidate[] = embeddings.map((row) => ({
      contractClauseId: row.contractClauseId,
      contractId: row.contractClause.contractId,
      contractTitle: row.contractClause.contract.title,
      clauseNumber: row.contractClause.clauseNumber,
      title: row.contractClause.title,
      text: row.contractClause.text,
      vectorScore: cosineSimilarity(params.queryVector, row.vector),
    }));

    return scored.sort((a, b) => b.vectorScore - a.vectorScore).slice(0, params.topK);
  }
}
