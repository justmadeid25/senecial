import { cosineSimilarity } from "@/domain/ai/cosine-similarity";
import type {
  ClauseVectorSearchCandidate,
  ClauseVectorSearchParams,
  ClauseVectorSearchProvider,
} from "@/domain/ai/clause-vector-search-provider";
import { latestReadySegmentationJobIdsForOrganization } from "@/server/repositories/analytics-repository";
import { prisma } from "@/server/db/client";

/**
 * §Phase 12.1 Part 8 - the pre-existing in-process cosine fallback,
 * refactored behind the ClauseVectorSearchProvider contract so
 * hybridSearchClauses/findSimilarClauses/etc. can use either this or
 * PgVectorClauseSearchProvider interchangeably. Same eligibility rules as
 * the pgvector provider (§9): org-scoped, only the latest ready
 * segmentation revision per document, only live (non-deleted) contracts,
 * only the current embeddingVersion, only rows matching the requested
 * embedding provider/model - reusing
 * latestReadySegmentationJobIdsForOrganization() (the exact same helper
 * analytics already relies on for "latest revision only") rather than
 * re-deriving that logic, so the two providers can never silently drift
 * apart on eligibility and produce non-comparable result sets.
 */
export class ApplicationCosineClauseSearchProvider implements ClauseVectorSearchProvider {
  readonly providerName = "application" as const;

  async search(params: ClauseVectorSearchParams): Promise<ClauseVectorSearchCandidate[]> {
    const eligibleJobIds = await latestReadySegmentationJobIdsForOrganization(params.organizationId);
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
