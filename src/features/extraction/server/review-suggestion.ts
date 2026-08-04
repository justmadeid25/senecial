import { Prisma } from "@/generated/prisma/client";
import { ExtractionJobStatus, SuggestionReviewStatus } from "@/generated/prisma/enums";
import { isValidNormalizedSuggestionValue } from "@/domain/extraction/validate-normalized-suggestion-value";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { reviewSuggestionSchema } from "@/lib/validation/extraction";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { assertCounterpartyBelongsToOrganization } from "@/features/contracts/server/validate-counterparty";
import { findExtractionJobById } from "@/server/repositories/extraction-job-repository";
import {
  findSuggestionById,
  updateSuggestionReview,
} from "@/server/repositories/field-suggestion-repository";
import { prisma } from "@/server/db/client";

export interface ReviewSuggestionParams {
  userId: string;
  organizationId: string;
  contractId: string;
  jobId: string;
  suggestionId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both review suggestions.
 *
 * "counterpartyName" is handled as a special case (§27): it has no
 * "accept as-is" meaning since there is no Contract column to write a bare
 * name into. EDIT requires an actual counterpartyId (an existing,
 * org-scoped Counterparty the reviewer picked in the UI) - never a name
 * string, and never an auto-created or auto-linked one. ACCEPT is
 * rejected outright for this field.
 */
export async function reviewSuggestion(params: ReviewSuggestionParams): Promise<void> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = reviewSuggestionSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  const job = await findExtractionJobById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    jobId: params.jobId,
  });
  if (!job) {
    throw new NotFoundError();
  }
  if (job.status !== ExtractionJobStatus.REVIEW_REQUIRED) {
    throw new ConflictError("검토 대기 상태의 작업만 검토할 수 있습니다.");
  }

  const suggestion = await findSuggestionById({
    organizationId: authContext.organizationId,
    extractionJobId: job.id,
    suggestionId: params.suggestionId,
  });
  if (!suggestion) {
    throw new NotFoundError();
  }

  let reviewStatus: SuggestionReviewStatus;
  let reviewedValue: Prisma.InputJsonValue | typeof Prisma.JsonNull;

  if (suggestion.fieldKey === "counterpartyName") {
    if (parsed.data.action === "ACCEPT") {
      throw new ValidationError(
        "상대방 제안은 그대로 승인할 수 없습니다 - 기존 상대방을 선택하거나 거절해 주세요."
      );
    }
    if (parsed.data.action === "REJECT") {
      reviewStatus = SuggestionReviewStatus.REJECTED;
      reviewedValue = Prisma.JsonNull;
    } else {
      const candidate = parsed.data.reviewedValue as { counterpartyId?: unknown } | undefined;
      const counterpartyId =
        typeof candidate?.counterpartyId === "string" ? candidate.counterpartyId : null;
      if (!counterpartyId) {
        throw new ValidationError("상대방을 선택해 주세요.");
      }
      await assertCounterpartyBelongsToOrganization(counterpartyId, authContext.organizationId);
      reviewStatus = SuggestionReviewStatus.EDITED;
      reviewedValue = { counterpartyId };
    }
  } else {
    switch (parsed.data.action) {
      case "ACCEPT":
        reviewStatus = SuggestionReviewStatus.ACCEPTED;
        reviewedValue = Prisma.JsonNull;
        break;
      case "REJECT":
        reviewStatus = SuggestionReviewStatus.REJECTED;
        reviewedValue = Prisma.JsonNull;
        break;
      case "EDIT": {
        if (
          !isValidNormalizedSuggestionValue(
            suggestion.fieldKey as Parameters<typeof isValidNormalizedSuggestionValue>[0],
            parsed.data.reviewedValue
          )
        ) {
          throw new ValidationError("수정한 값의 형식이 올바르지 않습니다.");
        }
        reviewStatus = SuggestionReviewStatus.EDITED;
        reviewedValue = parsed.data.reviewedValue as Prisma.InputJsonValue;
        break;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    const updated = await updateSuggestionReview(
      {
        organizationId: authContext.organizationId,
        suggestionId: suggestion.id,
        data: {
          reviewStatus,
          reviewedValue,
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
        entityType: "ContractFieldSuggestion",
        entityId: updated.id,
        action: AUDIT_ACTIONS.EXTRACTION_SUGGESTION_REVIEWED,
        metadata: {
          jobId: job.id,
          contractId: job.contractId,
          fieldKey: updated.fieldKey,
          reviewStatus,
        },
      },
    });
  });
}
