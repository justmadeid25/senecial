import { Prisma } from "@/generated/prisma/client";
import type {
  DocumentChunkVectorSearchCandidate,
  DocumentChunkVectorSearchParams,
  DocumentChunkVectorSearchProvider,
} from "@/domain/ai/document-chunk-vector-search-provider";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { cosineDistanceToSimilarity } from "@/domain/ai/vector-distance";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { latestAuthoritativeExtractedDocumentIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { prisma } from "@/server/db/client";

interface PgVectorChunkRow {
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
  distance: number;
}

/**
 * §Phase 14.1, revised §Phase 14.2 - mirrors PgVectorClauseSearchProvider,
 * for ContractDocumentChunk. §Phase 14.2 - a contract re-extracted via a
 * second file upload leaves the FIRST extraction's ContractExtractedDocument
 * (and its chunks) as live rows (replaceDocumentChunks() only replaces
 * chunks for the SAME extractedDocumentId, never a prior generation's) -
 * `extractedDocumentId = ANY(...)`, sourced from
 * ai-retrieval-freshness.ts's latestAuthoritativeExtractedDocumentIdsForOrganization(),
 * restricts every candidate to the single latest extraction per live
 * contract. organizationId, live contract, latest extraction, isLatest
 * embedding, matching provider/model, and dimension match are all
 * enforced in the SQL itself, never as an after-the-fact application
 * filter.
 */
export class PgVectorDocumentChunkSearchProvider implements DocumentChunkVectorSearchProvider {
  readonly providerName = "pgvector" as const;

  async search(params: DocumentChunkVectorSearchParams): Promise<DocumentChunkVectorSearchCandidate[]> {
    const eligibleDocumentIds = await latestAuthoritativeExtractedDocumentIdsForOrganization(params.organizationId);
    if (eligibleDocumentIds.length === 0) {
      return [];
    }

    const queryVectorText = serializeVectorForPg(params.queryVector, VECTOR_NATIVE_DIMENSION);

    const rows = await prisma.$queryRaw<PgVectorChunkRow[]>`
      SELECT
        ce."chunkId" AS "chunkId",
        dc."contractId" AS "contractId",
        c."title" AS "contractTitle",
        dc."chunkIndex" AS "chunkIndex",
        dc."headingContext" AS "headingContext",
        dc."text" AS "text",
        dc."startOffset" AS "startOffset",
        dc."endOffset" AS "endOffset",
        dc."sourcePageStart" AS "sourcePageStart",
        dc."sourcePageEnd" AS "sourcePageEnd",
        (ce."vectorNative" <=> ${queryVectorText}::vector) AS "distance"
      FROM "contract_document_chunk_embeddings" ce
      JOIN "contract_document_chunks" dc ON dc."id" = ce."chunkId"
      JOIN "contracts" c ON c."id" = dc."contractId"
      WHERE ce."organizationId" = ${params.organizationId}
        AND ce."isLatest" = true
        AND ce."provider" = ${params.embeddingProvider}
        AND ce."model" = ${params.embeddingModel}
        AND ce."vectorNative" IS NOT NULL
        AND c."deletedAt" IS NULL
        AND dc."extractedDocumentId" IN (${Prisma.join(eligibleDocumentIds)})
      ORDER BY "distance" ASC
      LIMIT ${params.topK}
    `;

    return rows.map((row) => ({
      chunkId: row.chunkId,
      contractId: row.contractId,
      contractTitle: row.contractTitle,
      chunkIndex: row.chunkIndex,
      headingContext: row.headingContext,
      text: row.text,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      sourcePageStart: row.sourcePageStart,
      sourcePageEnd: row.sourcePageEnd,
      vectorScore: cosineDistanceToSimilarity(row.distance),
    }));
  }
}
