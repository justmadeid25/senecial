import { Prisma } from "@/generated/prisma/client";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { prisma } from "@/server/db/client";

import { setChunkNativeVector } from "./contract-document-chunk-embedding-vector-repository";

export type ContractDocumentChunkEmbeddingRow = Prisma.ContractDocumentChunkEmbeddingGetPayload<Record<string, never>>;

export async function findLatestEmbeddingForChunk(chunkId: string): Promise<ContractDocumentChunkEmbeddingRow | null> {
  return prisma.contractDocumentChunkEmbedding.findFirst({
    where: { chunkId, isLatest: true },
  });
}

/**
 * §Phase 14.1 - mirrors createLatestClauseEmbedding() exactly: never
 * updates an existing row's vector/checksum in place, flips the previous
 * `isLatest` row to false and inserts a new one with `embeddingVersion`
 * incremented, both in one transaction, and dual-writes `vectorNative`
 * whenever the dimension matches VECTOR_NATIVE_DIMENSION.
 */
export async function createLatestChunkEmbedding(data: {
  organizationId: string;
  chunkId: string;
  provider: string;
  model: string;
  dimension: number;
  vector: number[];
  checksum: string;
}): Promise<ContractDocumentChunkEmbeddingRow> {
  return prisma.$transaction(async (tx) => {
    const previousLatest = await tx.contractDocumentChunkEmbedding.findFirst({
      where: { chunkId: data.chunkId, isLatest: true },
    });
    if (previousLatest) {
      await tx.contractDocumentChunkEmbedding.update({ where: { id: previousLatest.id }, data: { isLatest: false } });
    }

    const created = await tx.contractDocumentChunkEmbedding.create({
      data: {
        organizationId: data.organizationId,
        chunkId: data.chunkId,
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
      await setChunkNativeVector(created.id, data.vector, tx);
    }

    return created;
  });
}

/** Same "cheap fingerprint of the current isLatest set" pattern as getLatestEmbeddingGenerationChecksum() (clause-embedding-repository.ts) - used to invalidate a cached raw-retrieval result the instant an organization's chunk-embedding set changes. */
export async function getLatestChunkEmbeddingGenerationChecksum(organizationId: string): Promise<string> {
  const aggregate = await prisma.contractDocumentChunkEmbedding.aggregate({
    where: { organizationId, isLatest: true },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return `${aggregate._count._all}:${aggregate._max.createdAt?.getTime() ?? 0}`;
}
