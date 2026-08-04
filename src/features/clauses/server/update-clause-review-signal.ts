import type { ClauseReviewSignalStatus } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { updateClauseReviewSignalSchema } from "@/lib/validation/clauses";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  findClauseReviewSignalById,
  updateClauseReviewSignal as updateClauseReviewSignalRow,
} from "@/server/repositories/clause-review-signal-repository";
import { prisma } from "@/server/db/client";

export interface UpdateClauseReviewSignalParams {
  userId: string;
  organizationId: string;
  contractId: string;
  signalId: string;
  input: unknown;
}

const STATUS_BY_ACTION: Record<string, ClauseReviewSignalStatus> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  DISMISS: "DISMISSED",
  RESOLVE: "RESOLVED",
};

/** OWNER and MEMBER can both act on review signals (§29). The signal's own signalType/evidenceText are never overwritten - only status/reviewedBy/reviewedAt/reviewNote change. */
export async function updateClauseReviewSignal(params: UpdateClauseReviewSignalParams): Promise<void> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = updateClauseReviewSignalSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  const signal = await findClauseReviewSignalById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    signalId: params.signalId,
  });
  if (!signal) {
    throw new NotFoundError();
  }

  const status = STATUS_BY_ACTION[parsed.data.action];
  if (!status) {
    throw new ValidationError("입력값이 올바르지 않습니다.");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await updateClauseReviewSignalRow(
      {
        organizationId: authContext.organizationId,
        signalId: signal.id,
        data: {
          status,
          reviewedById: authContext.userId,
          reviewedAt: new Date(),
          reviewNote: parsed.data.reviewNote ?? null,
        },
      },
      tx
    );
    if (!updated) {
      throw new NotFoundError();
    }

    // reviewNote is never included - see AUDIT_ACTIONS.CLAUSE_REVIEW_SIGNAL_UPDATED's allowed metadata (§33).
    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ClauseReviewSignal",
        entityId: signal.id,
        action: AUDIT_ACTIONS.CLAUSE_REVIEW_SIGNAL_UPDATED,
        metadata: { contractId: params.contractId, signalId: signal.id, status },
      },
    });
  });
}
