import type {
  DocumentChunkVectorSearchCandidate,
  DocumentChunkVectorSearchParams,
  DocumentChunkVectorSearchProvider,
} from "@/domain/ai/document-chunk-vector-search-provider";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { cosineDistanceToSimilarity } from "@/domain/ai/vector-distance";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
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
 * §Phase 14.1 - mirrors PgVectorClauseSearchProvider exactly, for
 * ContractDocumentChunk. No segmentation-revision filter (chunks have no
 * such concept - replaceDocumentChunks() always keeps exactly the current
 * generation, never stale old chunks alongside new ones) - organizationId,
 * live contract, isLatest embedding, matching provider/model, and
 * dimension match are all enforced in the SQL itself, never as an
 * after-the-fact application filter.
 */
export class PgVectorDocumentChunkSearchProvider implements DocumentChunkVectorSearchProvider {
  readonly providerName = "pgvector" as const;

  async search(params: DocumentChunkVectorSearchParams): Promise<DocumentChunkVectorSearchCandidate[]> {
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
