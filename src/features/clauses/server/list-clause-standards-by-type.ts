import type { ClauseType } from "@/generated/prisma/enums";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  findClauseStandardsByType,
  type ClauseStandardRow,
} from "@/server/repositories/clause-standard-repository";

export interface ListClauseStandardsByTypeParams {
  userId: string;
  organizationId: string;
  clauseType: ClauseType;
}

/** Active standards for a given type only - the compare screen never auto-picks one, the user always chooses (§31). */
export async function listClauseStandardsByType(
  params: ListClauseStandardsByTypeParams
): Promise<ClauseStandardRow[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  return findClauseStandardsByType({
    organizationId: authContext.organizationId,
    clauseType: params.clauseType,
    activeOnly: true,
  });
}
