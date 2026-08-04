import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { getVectorBackfillStats } from "@/server/repositories/clause-embedding-vector-repository";
import { prisma } from "@/server/db/client";

export interface VectorSearchDetails {
  extensionInstalled: boolean;
  extensionVersion: string | null;
  expectedDimension: number;
  vectorColumnExists: boolean;
  embeddingRowCount: number;
  vectorizedRowCount: number;
  staleRowCount: number;
  indexExists: boolean;
  probeQuerySucceeded: boolean;
  probeQueryError: string | null;
}

/**
 * §Phase 12.1 Part 13 - the DETAILED, operator-only vector search
 * diagnostic (scripts/validate-production-readiness.ts only - never the
 * public /api/health/ready response, which stays a plain "ok"/"error" via
 * checkReadiness()'s checkVectorSearch()). Every field here is a count,
 * a boolean, or a version string - never clause text, a search query, or
 * an embedding value.
 */
export async function probeVectorSearchDetails(): Promise<VectorSearchDetails> {
  const extensionRows = await prisma.$queryRaw<Array<{ extversion: string }>>`
    SELECT extversion FROM pg_extension WHERE extname = 'vector'
  `;
  const extensionInstalled = extensionRows.length > 0;
  const extensionVersion = extensionRows[0]?.extversion ?? null;

  const columnRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clause_embeddings' AND column_name = 'vectorNative'
    ) AS "exists"
  `;
  const vectorColumnExists = columnRows[0]?.exists ?? false;

  const indexRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'clause_embeddings' AND indexname = 'clause_embeddings_vector_native_hnsw_idx'
    ) AS "exists"
  `;
  const indexExists = indexRows[0]?.exists ?? false;

  const backfillStats = await getVectorBackfillStats();
  const embeddingRowCount = await prisma.clauseEmbedding.count({ where: { isLatest: true } });

  let probeQuerySucceeded = false;
  let probeQueryError: string | null = null;
  if (extensionInstalled) {
    try {
      await prisma.$queryRaw`SELECT '[1,0,0]'::vector(3) <=> '[1,0,0]'::vector(3)`;
      probeQuerySucceeded = true;
    } catch (error) {
      probeQueryError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    extensionInstalled,
    extensionVersion,
    expectedDimension: VECTOR_NATIVE_DIMENSION,
    vectorColumnExists,
    embeddingRowCount,
    vectorizedRowCount: backfillStats.populated,
    staleRowCount: backfillStats.stale,
    indexExists,
    probeQuerySucceeded,
    probeQueryError,
  };
}
