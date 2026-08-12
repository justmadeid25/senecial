import { Prisma } from "@/generated/prisma/client";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { latestAuthoritativeClauseSegmentationJobIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { prisma } from "@/server/db/client";

import { setNativeVector } from "./clause-embedding-vector-repository";

export type ClauseEmbeddingRow = Prisma.ClauseEmbeddingGetPayload<Record<string, never>>;

export async function findLatestEmbeddingForClause(contractClauseId: string): Promise<ClauseEmbeddingRow | null> {
  return prisma.clauseEmbedding.findFirst({
    where: { contractClauseId, isLatest: true },
  });
}

/**
 * §Embedding Pipeline - "기존 조항은 수정하지 않는다": this NEVER updates an
 * existing ClauseEmbedding row's `vector`/`checksum` - it flips the
 * previous latest row's `isLatest` to false and inserts a brand new row
 * with `embeddingVersion` incremented, both inside one transaction (a
 * reader can never observe a moment with zero or two `isLatest=true` rows
 * for the same clause).
 *
 * §Phase 12.1 - dual-writes the real pgvector column (`vectorNative`) in
 * the SAME transaction whenever the new vector's dimension matches
 * VECTOR_NATIVE_DIMENSION - every embedding created from this point
 * forward is immediately visible to PgVectorClauseSearchProvider, not
 * just rows the vector-backfill CLI has already caught up on. A row whose
 * dimension does not match is left with `vectorNative` NULL, exactly like
 * a not-yet-backfilled legacy row - it simply never becomes eligible for
 * the native column (pgvector's one-fixed-width-per-column constraint;
 * see vector-search-config.ts).
 */
export async function createLatestClauseEmbedding(data: {
  organizationId: string;
  contractClauseId: string;
  provider: string;
  model: string;
  dimension: number;
  vector: number[];
  checksum: string;
}): Promise<ClauseEmbeddingRow> {
  return prisma.$transaction(async (tx) => {
    const previousLatest = await tx.clauseEmbedding.findFirst({
      where: { contractClauseId: data.contractClauseId, isLatest: true },
    });
    if (previousLatest) {
      await tx.clauseEmbedding.update({ where: { id: previousLatest.id }, data: { isLatest: false } });
    }

    const created = await tx.clauseEmbedding.create({
      data: {
        organizationId: data.organizationId,
        contractClauseId: data.contractClauseId,
        provider: data.provider,
        model: data.model,
        dimension: data.dimension,
        vector: data.vector,
        checksum: data.checksum,
        embeddingVersion: (previousLatest?.embeddingVersion ?? 0) + 1,
        isLatest: true,
      },
    });

    if (data.dimension === VECTOR_NATIVE_DIMENSION) {
      await setNativeVector(created.id, data.vector, tx);
    }

    return created;
  });
}

/**
 * §Cache checksum invalidation (Phase 12 Part N), revised §Phase 14.2 -
 * a cheap fingerprint of an organization's CURRENT retrieval-eligible
 * `isLatest` embedding set, used to invalidate a cached retrieval result
 * the instant that set changes (a new clause gets embedded, an existing
 * one's embedding is superseded by a new version, a contract is
 * soft-deleted, or a contract is re-extracted+re-segmented so a
 * DIFFERENT revision becomes authoritative - see
 * createLatestClauseEmbedding()'s own docstring and
 * ai-retrieval-freshness.ts). Scoped to
 * latestAuthoritativeClauseSegmentationJobIdsForOrganization() - the
 * EXACT same "latest revision per live contract" set the retrieval
 * queries themselves filter by - so this checksum can never claim "the
 * retrieval corpus hasn't changed" while the corpus a real (uncached)
 * query would actually see has. `jobIds.length` is included explicitly
 * (not just count+max(createdAt) of embeddings) so a contract deletion or
 * revision swap that happens to preserve embedding count/timestamp
 * statistics still changes the checksum.
 */
export async function getLatestEmbeddingGenerationChecksum(organizationId: string): Promise<string> {
  const jobIds = await latestAuthoritativeClauseSegmentationJobIdsForOrganization(organizationId);
  if (jobIds.length === 0) {
    return "0:0:0";
  }
  const aggregate = await prisma.clauseEmbedding.aggregate({
    where: { organizationId, isLatest: true, contractClause: { segmentationJobId: { in: jobIds } } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return `${aggregate._count._all}:${aggregate._max.createdAt?.getTime() ?? 0}:${jobIds.length}`;
}
