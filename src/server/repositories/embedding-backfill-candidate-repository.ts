import { prisma } from "@/server/db/client";

export interface EmbeddingBackfillCandidate {
  contractClauseId: string;
  organizationId: string;
  normalizedText: string;
}

/**
 * §Phase 13 Part C (§9/§10) - dual-embedding rollout: a clause "needs
 * backfill" when it has at least one `isLatest` embedding already (it went
 * through the normal pipeline once) but that `isLatest` row is NOT from
 * the currently-configured production provider/model - i.e. it is still
 * on the development hashing embedding (or a since-retired production
 * model). A clause with ZERO embeddings yet is left alone here - the
 * ordinary EmbeddingJob queue already embeds it with whatever provider is
 * currently configured, no special dual-rollout handling needed.
 */
export async function findEmbeddingBackfillCandidates(params: {
  targetProvider: string;
  targetModel: string;
  limit: number;
  organizationId?: string;
}): Promise<EmbeddingBackfillCandidate[]> {
  const rows = await prisma.contractClause.findMany({
    where: {
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      embeddings: { some: { isLatest: true } },
      NOT: { embeddings: { some: { isLatest: true, provider: params.targetProvider, model: params.targetModel } } },
    },
    select: { id: true, organizationId: true, normalizedText: true },
    take: params.limit,
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({ contractClauseId: row.id, organizationId: row.organizationId, normalizedText: row.normalizedText }));
}

export async function countEmbeddingBackfillCandidates(params: { targetProvider: string; targetModel: string; organizationId?: string }): Promise<number> {
  return prisma.contractClause.count({
    where: {
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      embeddings: { some: { isLatest: true } },
      NOT: { embeddings: { some: { isLatest: true, provider: params.targetProvider, model: params.targetModel } } },
    },
  });
}
