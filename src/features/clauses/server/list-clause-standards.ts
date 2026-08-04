import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  listClauseStandards as listClauseStandardsRepo,
  type ClauseStandardRow,
} from "@/server/repositories/clause-standard-repository";

export interface ListClauseStandardsParams {
  userId: string;
  organizationId: string;
}

/** OWNER and MEMBER can both read (§21). */
export async function listClauseStandards(
  params: ListClauseStandardsParams
): Promise<ClauseStandardRow[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  return listClauseStandardsRepo({ organizationId: authContext.organizationId });
}
