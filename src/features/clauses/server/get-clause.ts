import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseById, type ContractClauseRow } from "@/server/repositories/contract-clause-repository";

export interface GetClauseParams {
  userId: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
}

export async function getClause(params: GetClauseParams): Promise<ContractClauseRow> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const clause = await findClauseById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    clauseId: params.clauseId,
  });
  if (!clause) {
    throw new NotFoundError();
  }
  return clause;
}
