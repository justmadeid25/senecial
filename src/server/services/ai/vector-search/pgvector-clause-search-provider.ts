import { Prisma } from "@/generated/prisma/client";
import type {
  ClauseVectorSearchCandidate,
  ClauseVectorSearchParams,
  ClauseVectorSearchProvider,
} from "@/domain/ai/clause-vector-search-provider";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { cosineDistanceToSimilarity } from "@/domain/ai/vector-distance";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { latestAuthoritativeClauseSegmentationJobIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_SQL } from "@/server/repositories/clause-evidence-eligibility";
import { prisma } from "@/server/db/client";

interface PgVectorRow {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  distance: number;
}

/**
 * §Phase 12.1 Part 8/9 - real DB-native ANN search via pgvector's `<=>`
 * cosine-distance operator, over the HNSW index (see the
 * pgvector_clause_embeddings migration). Every condition in §9's required
 * list is enforced IN THE SQL ITSELF, never applied as an
 * after-the-fact filter in application code once results are already
 * back (the exact anti-pattern §9 explicitly bans): organizationId,
 * live contract (`deletedAt IS NULL`), latest segmentation revision
 * PER CONTRACT (`segmentationJobId = ANY(...)`, sourced from
 * ai-retrieval-freshness.ts's latestAuthoritativeClauseSegmentationJobIdsForOrganization()
 * - §Phase 14.2: this used to source from analytics-repository.ts's
 * latestReadySegmentationJobIdsForOrganization(), which dedupes "latest
 * job PER EXTRACTED DOCUMENT," not per contract - a contract re-extracted
 * via a second file upload got a genuinely new ContractExtractedDocument,
 * and that helper let BOTH the old and new document's segmentation jobs
 * stay "eligible" simultaneously, so a stale prior-revision clause could
 * still rank and return here alongside the current one. Verified
 * empirically before this fix), current embeddingVersion (`isLatest =
 * true`), matching provider/model, and dimension match (`vectorNative IS
 * NOT NULL` - a row whose dimension differs from VECTOR_NATIVE_DIMENSION
 * never has this column populated at all - see
 * clause-embedding-vector-repository.ts).
 *
 * Every value is a bound parameter (Prisma's tagged-template
 * `$queryRaw`/`Prisma.join`) - never string-concatenated into the query
 * text, including the vector literal and the job-id list.
 */
export class PgVectorClauseSearchProvider implements ClauseVectorSearchProvider {
  readonly providerName = "pgvector" as const;

  async search(params: ClauseVectorSearchParams): Promise<ClauseVectorSearchCandidate[]> {
    const eligibleJobIds = await latestAuthoritativeClauseSegmentationJobIdsForOrganization(params.organizationId);
    if (eligibleJobIds.length === 0) {
      return [];
    }

    const queryVectorText = serializeVectorForPg(params.queryVector, VECTOR_NATIVE_DIMENSION);

    const rows = await prisma.$queryRaw<PgVectorRow[]>`
      SELECT
        ce."contractClauseId" AS "contractClauseId",
        cc."contractId" AS "contractId",
        c."title" AS "contractTitle",
        cc."clauseNumber" AS "clauseNumber",
        cc."title" AS "title",
        cc."text" AS "text",
        (ce."vectorNative" <=> ${queryVectorText}::vector) AS "distance"
      FROM "clause_embeddings" ce
      JOIN "contract_clauses" cc ON cc."id" = ce."contractClauseId"
      JOIN "contracts" c ON c."id" = cc."contractId"
      WHERE ce."organizationId" = ${params.organizationId}
        AND ce."isLatest" = true
        AND ce."provider" = ${params.embeddingProvider}
        AND ce."model" = ${params.embeddingModel}
        AND ce."vectorNative" IS NOT NULL
        AND c."deletedAt" IS NULL
        AND cc."segmentationJobId" IN (${Prisma.join(eligibleJobIds)})
        ${EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_SQL}
        ${params.contractId ? Prisma.sql`AND cc."contractId" = ${params.contractId}` : Prisma.empty}
      ORDER BY "distance" ASC
      LIMIT ${params.topK}
    `;

    return rows.map((row) => ({
      contractClauseId: row.contractClauseId,
      contractId: row.contractId,
      contractTitle: row.contractTitle,
      clauseNumber: row.clauseNumber,
      title: row.title,
      text: row.text,
      vectorScore: cosineDistanceToSimilarity(row.distance),
    }));
  }
}
