import type { ClauseReviewSignalStatus, ClauseReviewSignalType, ClauseType } from "@/generated/prisma/enums";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  listClauseReviewSignalsForContract,
  type ClauseReviewSignalRow,
} from "@/server/repositories/clause-review-signal-repository";

export interface ListClauseReviewSignalsParams {
  userId: string;
  organizationId: string;
  contractId: string;
  status?: ClauseReviewSignalStatus;
  signalType?: ClauseReviewSignalType;
  clauseType?: ClauseType;
}

export async function listClauseReviewSignals(
  params: ListClauseReviewSignalsParams
): Promise<ClauseReviewSignalRow[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  return listClauseReviewSignalsForContract({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    status: params.status,
    signalType: params.signalType,
    clauseType: params.clauseType,
  });
}
