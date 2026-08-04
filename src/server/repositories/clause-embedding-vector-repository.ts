import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * §Phase 12.1 - every read/write of `ClauseEmbedding.vectorNative` goes
 * through raw SQL here, never the generated Prisma Client model API -
 * `Unsupported("vector(256)")` fields are invisible to Prisma Client's
 * normal select/where/data shapes by design (Prisma cannot generate types
 * for a column type it does not understand), so this is the ONLY place in
 * the codebase allowed to reference the `vectorNative` column by name.
 * Every parameter below is bound (tagged-template `$queryRaw`/`$executeRaw`
 * - never string concatenation), including inside a `::vector` cast.
 */

export interface VectorBackfillCandidateRow {
  id: string;
  vector: number[];
}

/**
 * Only `isLatest` rows are ever eligible - a superseded embedding version
 * is never searched (see clause-embedding-repository.ts), so backfilling
 * it into the native column would be wasted write volume for a vector
 * nothing will ever query. Only rows whose `dimension` matches the fixed
 * column width are eligible at all - a mismatched-dimension row can never
 * be stored in `vector(256)` (see vector-search-config.ts).
 */
export async function findVectorBackfillCandidates(limit: number): Promise<VectorBackfillCandidateRow[]> {
  return prisma.$queryRaw<VectorBackfillCandidateRow[]>`
    SELECT "id", "vector"
    FROM "clause_embeddings"
    WHERE "isLatest" = true
      AND "dimension" = ${VECTOR_NATIVE_DIMENSION}
      AND "vectorNative" IS NULL
    ORDER BY "createdAt" ASC
    LIMIT ${limit}
  `;
}

export async function countVectorBackfillCandidates(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM "clause_embeddings"
    WHERE "isLatest" = true
      AND "dimension" = ${VECTOR_NATIVE_DIMENSION}
      AND "vectorNative" IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Guarded by `AND "isLatest" = true` in the UPDATE itself (not just the
 * earlier SELECT) - if a row was superseded by a new embedding version
 * between being read as a candidate and being written here, this becomes
 * a safe no-op instead of writing a native vector for a row nothing will
 * ever query again.
 */
export async function setNativeVector(id: string, vector: readonly number[], client: DbClient = prisma): Promise<void> {
  const serialized = serializeVectorForPg(vector, VECTOR_NATIVE_DIMENSION);
  await client.$executeRaw`
    UPDATE "clause_embeddings"
    SET "vectorNative" = ${serialized}::vector
    WHERE "id" = ${id} AND "isLatest" = true
  `;
}

export interface VectorBackfillStats {
  /** isLatest rows whose dimension matches the native column's fixed width - the only rows that can ever be backfilled. */
  totalEligible: number;
  /** Of those, how many already have vectorNative populated. */
  populated: number;
  /** isLatest rows whose dimension does NOT match - permanently ineligible until a future migration changes the column width (see vector-search-config.ts). */
  stale: number;
}

export async function getVectorBackfillStats(): Promise<VectorBackfillStats> {
  const rows = await prisma.$queryRaw<Array<{ total_eligible: bigint; populated: bigint; stale: bigint }>>`
    SELECT
      count(*) FILTER (WHERE "isLatest" = true AND "dimension" = ${VECTOR_NATIVE_DIMENSION})::bigint AS total_eligible,
      count(*) FILTER (
        WHERE "isLatest" = true AND "dimension" = ${VECTOR_NATIVE_DIMENSION} AND "vectorNative" IS NOT NULL
      )::bigint AS populated,
      count(*) FILTER (WHERE "isLatest" = true AND "dimension" != ${VECTOR_NATIVE_DIMENSION})::bigint AS stale
    FROM "clause_embeddings"
  `;
  const row = rows[0]!;
  return {
    totalEligible: Number(row.total_eligible),
    populated: Number(row.populated),
    stale: Number(row.stale),
  };
}

export interface VectorVerificationRow {
  id: string;
  vector: number[];
  nativeText: string;
}

/** Random sample of already-backfilled rows, for --verify to spot-check the native column against the original fallback vector (see run-vector-backfill.ts). */
export async function sampleBackfilledVectors(sampleSize: number): Promise<VectorVerificationRow[]> {
  return prisma.$queryRaw<VectorVerificationRow[]>`
    SELECT "id", "vector", ("vectorNative"::text) AS "nativeText"
    FROM "clause_embeddings"
    WHERE "vectorNative" IS NOT NULL
    ORDER BY random()
    LIMIT ${sampleSize}
  `;
}
