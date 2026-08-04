import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  findClauseStandardById,
  type ClauseStandardRow,
} from "@/server/repositories/clause-standard-repository";

export interface GetClauseStandardParams {
  userId: string;
  organizationId: string;
  standardId: string;
}

/** OWNER and MEMBER can both read (§21). */
export async function getClauseStandard(params: GetClauseStandardParams): Promise<ClauseStandardRow> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const standard = await findClauseStandardById({
    organizationId: authContext.organizationId,
    standardId: params.standardId,
  });
  if (!standard) {
    throw new NotFoundError();
  }
  return standard;
}
