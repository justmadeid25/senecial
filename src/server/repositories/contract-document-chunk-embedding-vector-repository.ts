import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * §Phase 14.1 - mirrors clause-embedding-vector-repository.ts exactly,
 * for `contract_document_chunk_embeddings.vectorNative`. Every read/write
 * of that column goes through raw SQL here, never the generated Prisma
 * Client model API (`Unsupported("vector(256)")` is invisible to it) -
 * every parameter is bound (tagged-template, never string concatenation).
 */
export async function setChunkNativeVector(
  id: string,
  vector: readonly number[],
  client: DbClient = prisma
): Promise<void> {
  const serialized = serializeVectorForPg(vector, VECTOR_NATIVE_DIMENSION);
  await client.$executeRaw`
    UPDATE "contract_document_chunk_embeddings"
    SET "vectorNative" = ${serialized}::vector
    WHERE "id" = ${id} AND "isLatest" = true
  `;
}

export interface ChunkVectorBackfillStats {
  totalEligible: number;
  populated: number;
  stale: number;
}

export async function getChunkVectorBackfillStats(): Promise<ChunkVectorBackfillStats> {
  const rows = await prisma.$queryRaw<Array<{ total_eligible: bigint; populated: bigint; stale: bigint }>>`
    SELECT
      count(*) FILTER (WHERE "isLatest" = true AND "dimension" = ${VECTOR_NATIVE_DIMENSION})::bigint AS total_eligible,
      count(*) FILTER (
        WHERE "isLatest" = true AND "dimension" = ${VECTOR_NATIVE_DIMENSION} AND "vectorNative" IS NOT NULL
      )::bigint AS populated,
      count(*) FILTER (WHERE "isLatest" = true AND "dimension" != ${VECTOR_NATIVE_DIMENSION})::bigint AS stale
    FROM "contract_document_chunk_embeddings"
  `;
  const row = rows[0]!;
  return {
    totalEligible: Number(row.total_eligible),
    populated: Number(row.populated),
    stale: Number(row.stale),
  };
}
