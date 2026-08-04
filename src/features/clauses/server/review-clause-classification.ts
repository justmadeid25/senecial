import type { ClauseClassificationState, ClauseType } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { reviewClauseClassificationSchema } from "@/lib/validation/clauses";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseById, updateClauseReview } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

export interface ReviewClauseClassificationParams {
  userId: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both review classifications (§7). CONFIRM never
 * auto-happens - a human must explicitly click it even when they agree
 * with the suggestion, and suggestedClauseType is never overwritten (the
 * confirmed/corrected value always lands in reviewedClauseType instead).
 */
export async function reviewClauseClassification(params: ReviewClauseClassificationParams): Promise<void> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = reviewClauseClassificationSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  const clause = await findClauseById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    clauseId: params.clauseId,
  });
  if (!clause) {
    throw new NotFoundError();
  }

  let classificationState: ClauseClassificationState;
  let reviewedClauseType: ClauseType | null;

  switch (parsed.data.action) {
    case "CONFIRM":
      classificationState = "CONFIRMED";
      reviewedClauseType = clause.suggestedClauseType;
      break;
    case "CORRECT":
      if (!parsed.data.reviewedClauseType) {
        throw new ValidationError("변경할 조항 유형을 선택해 주세요.");
      }
      classificationState = "CORRECTED";
      reviewedClauseType = parsed.data.reviewedClauseType;
      break;
    case "REJECT":
      classificationState = "REJECTED";
      reviewedClauseType = null;
      break;
  }

  await prisma.$transaction(async (tx) => {
    const updated = await updateClauseReview(
      {
        organizationId: authContext.organizationId,
        clauseId: clause.id,
        data: {
          classificationState,
          reviewedClauseType,
          reviewedById: authContext.userId,
          reviewedAt: new Date(),
        },
      },
      tx
    );
    if (!updated) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ContractClause",
        entityId: clause.id,
        action: AUDIT_ACTIONS.CLAUSE_CLASSIFICATION_REVIEWED,
        metadata: { contractId: params.contractId, clauseId: clause.id, classificationState },
      },
    });
  });
}
