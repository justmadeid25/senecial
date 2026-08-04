import { compareClauseToStandard as computeComparison, type ClauseComparisonResult } from "@/domain/clauses/clause-diff";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseById } from "@/server/repositories/contract-clause-repository";
import { findClauseStandardById } from "@/server/repositories/clause-standard-repository";
import { prisma } from "@/server/db/client";

export interface CompareClauseToStandardParams {
  userId: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
  standardId: string;
}

export interface ClauseComparisonView extends ClauseComparisonResult {
  clauseId: string;
  standardId: string;
  standardName: string;
}

/**
 * Computed on demand, never persisted (§23's design decision - a
 * deterministic function is cheap to recompute and this keeps the schema
 * simpler). Never mutates the contract or the clause - purely read/derive.
 * AuditLog records that a comparison was viewed, never the compared text.
 */
export async function compareClauseToStandard(
  params: CompareClauseToStandardParams
): Promise<ClauseComparisonView> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const [clause, standard] = await Promise.all([
    findClauseById({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
      clauseId: params.clauseId,
    }),
    findClauseStandardById({
      organizationId: authContext.organizationId,
      standardId: params.standardId,
    }),
  ]);
  if (!clause || !standard) {
    throw new NotFoundError();
  }

  const comparison = computeComparison(clause.text, standard.text);

  await prisma.auditLog.create({
    data: {
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      entityType: "ContractClause",
      entityId: clause.id,
      action: AUDIT_ACTIONS.CLAUSE_COMPARISON_VIEWED,
      metadata: { contractId: params.contractId, clauseId: clause.id, standardId: standard.id },
    },
  });

  return { ...comparison, clauseId: clause.id, standardId: standard.id, standardName: standard.name };
}
