import { compareClauseToStandard as computeComparison, type ClauseComparisonResult } from "@/domain/clauses/clause-diff";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findLatestEmbeddingForClause } from "@/server/repositories/clause-embedding-repository";
import { findClauseById } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

import { searchClauseVectors } from "./search-clause-vectors";

export interface SimilarClauseResult {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  similarityScore: number;
  comparison: ClauseComparisonResult;
}

const DEFAULT_TOP_K = 10;

/**
 * §Similar Clause (Phase 12 Part I) - "상위 10개 + diff". Ranks every other
 * clause in the ORGANIZATION (any contract, not just this one) by cosine
 * similarity, then attaches a deterministic text diff
 * (domain/clauses/clause-diff.ts - the same LCS-based diff already used by
 * compareClauseToStandard) against the source clause for each result.
 * Never mutates anything - purely read/derive, matching
 * compareClauseToStandard's "computed on demand, never persisted" design.
 *
 * §Phase 12.1 - the ranking itself goes through the same
 * ClauseVectorSearchProvider abstraction hybrid search uses (real
 * DB-native pgvector by default), asking for one extra result (`topK + 1`)
 * since the clause's own embedding is always its own nearest neighbor and
 * must be filtered out before truncating to the requested count.
 */
export async function findSimilarClauses(params: {
  userId: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
  topK?: number;
}): Promise<SimilarClauseResult[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const topK = params.topK ?? DEFAULT_TOP_K;

  const clause = await findClauseById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    clauseId: params.clauseId,
  });
  if (!clause) {
    throw new NotFoundError();
  }

  const ownEmbedding = await findLatestEmbeddingForClause(clause.id);
  if (!ownEmbedding) {
    // Embedding job hasn't completed yet (or clause has no embeddable
    // text) - never an error, just no results to show yet.
    return [];
  }

  const candidates = await searchClauseVectors({
    organizationId: authContext.organizationId,
    queryVector: ownEmbedding.vector,
    embeddingProvider: ownEmbedding.provider,
    embeddingModel: ownEmbedding.model,
    topK: topK + 1,
  });
  const ranked = candidates.filter((candidate) => candidate.contractClauseId !== clause.id).slice(0, topK);

  if (ranked.length === 0) {
    return [];
  }

  const results: SimilarClauseResult[] = ranked.map((candidate) => ({
    contractClauseId: candidate.contractClauseId,
    contractId: candidate.contractId,
    contractTitle: candidate.contractTitle,
    clauseNumber: candidate.clauseNumber,
    title: candidate.title,
    text: candidate.text,
    similarityScore: candidate.vectorScore,
    comparison: computeComparison(clause.text, candidate.text),
  }));

  await prisma.auditLog.create({
    data: {
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      entityType: "ContractClause",
      entityId: clause.id,
      action: AUDIT_ACTIONS.SIMILAR_CLAUSES_VIEWED,
      metadata: { contractId: params.contractId, clauseId: clause.id, resultCount: results.length },
    },
  });

  return results;
}
