import { Prisma } from "@/generated/prisma/client";
import { ExtractionJobStatus, SuggestionReviewStatus } from "@/generated/prisma/enums";
import { hasContractChangedSinceExtraction } from "@/domain/extraction/optimistic-concurrency";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { updateContractSchema } from "@/lib/validation/contracts";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { assertCounterpartyBelongsToOrganization } from "@/features/contracts/server/validate-counterparty";
import { findContractById, updateContract as updateContractRow } from "@/server/repositories/contract-repository";
import {
  findExtractionJobById,
  updateExtractionJob,
} from "@/server/repositories/extraction-job-repository";
import { findSuggestionsByJobId, type FieldSuggestionRow } from "@/server/repositories/field-suggestion-repository";
import { prisma } from "@/server/db/client";

export interface ApplyApprovedSuggestionsParams {
  userId: string;
  organizationId: string;
  contractId: string;
  jobId: string;
}

export interface ApplyApprovedSuggestionsResult {
  appliedFieldCount: number;
}

function extractSuggestionValue(suggestion: FieldSuggestionRow): unknown {
  return suggestion.reviewStatus === SuggestionReviewStatus.EDITED
    ? suggestion.reviewedValue
    : suggestion.normalizedValue;
}

/**
 * OWNER and MEMBER can both apply approved suggestions - only membership
 * is required (matches review permission).
 *
 * The ONLY function in this codebase that lets extraction results reach a
 * Contract row. Every value is merged onto the contract's CURRENT values
 * and re-validated through the exact same updateContractSchema the manual
 * edit form uses - a suggestion can never produce a contract state the
 * form itself would reject. PENDING and REJECTED suggestions are never
 * applied; only ACCEPTED (normalizedValue) and EDITED (reviewedValue).
 */
export async function applyApprovedSuggestions(
  params: ApplyApprovedSuggestionsParams
): Promise<ApplyApprovedSuggestionsResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const job = await findExtractionJobById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    jobId: params.jobId,
  });
  if (!job) {
    throw new NotFoundError();
  }
  if (job.status !== ExtractionJobStatus.REVIEW_REQUIRED) {
    throw new ConflictError("검토 대기 상태의 작업만 계약에 적용할 수 있습니다.");
  }

  const contract = await findContractById({
    organizationId: authContext.organizationId,
    contractId: job.contractId,
  });
  if (!contract) {
    throw new NotFoundError();
  }

  // Optimistic concurrency (§26): if the contract changed after suggestions
  // became ready for review, refuse to silently overwrite whatever changed
  // it - the reviewer must look again.
  if (hasContractChangedSinceExtraction(contract.updatedAt, job.contractUpdatedAtSnapshot)) {
    throw new ConflictError(
      "계약 정보가 추출 이후 변경되었습니다. 현재 값과 제안값을 다시 확인해 주세요."
    );
  }

  const suggestions = await findSuggestionsByJobId({
    organizationId: authContext.organizationId,
    extractionJobId: job.id,
  });
  const applicable = suggestions.filter(
    (suggestion) =>
      suggestion.reviewStatus === SuggestionReviewStatus.ACCEPTED ||
      suggestion.reviewStatus === SuggestionReviewStatus.EDITED
  );

  const payload: Record<string, unknown> = {
    title: contract.title,
    contractNumber: contract.contractNumber ?? "",
    contractType: contract.contractType,
    status: contract.status,
    startDate: contract.startDate ?? "",
    endDate: contract.endDate ?? "",
    signedDate: contract.signedDate ?? "",
    autoRenewal: contract.autoRenewal,
    noticePeriodDays: contract.noticePeriodDays ?? "",
    amount: contract.amount ? contract.amount.toString() : "",
    currency: contract.currency ?? "KRW",
    governingLaw: contract.governingLaw ?? "",
    jurisdiction: contract.jurisdiction ?? "",
    description: contract.description ?? "",
    counterpartyId: contract.counterpartyId ?? "",
  };

  const appliedFieldKeys: string[] = [];

  for (const suggestion of applicable) {
    const value = extractSuggestionValue(suggestion);

    if (suggestion.fieldKey === "counterpartyName") {
      // Only ever reachable as EDITED with { counterpartyId } - see
      // review-suggestion.ts, which blocks ACCEPT for this field entirely.
      const counterpartyId = (value as { counterpartyId?: unknown } | null)?.counterpartyId;
      if (typeof counterpartyId === "string") {
        await assertCounterpartyBelongsToOrganization(counterpartyId, authContext.organizationId);
        payload.counterpartyId = counterpartyId;
        appliedFieldKeys.push("counterpartyId");
      }
      continue;
    }

    const extracted = (value as { value?: unknown } | null)?.value;
    if (extracted === undefined) {
      continue;
    }

    switch (suggestion.fieldKey) {
      case "title":
      case "contractNumber":
      case "contractType":
      case "startDate":
      case "endDate":
      case "signedDate":
      case "autoRenewal":
      case "noticePeriodDays":
      case "amount":
      case "currency":
      case "governingLaw":
      case "jurisdiction":
        payload[suggestion.fieldKey] = extracted;
        appliedFieldKeys.push(suggestion.fieldKey);
        break;
      default:
        break;
    }
  }

  if (appliedFieldKeys.length === 0) {
    throw new ValidationError("적용할 승인된 제안이 없습니다.");
  }

  const parsed = updateContractSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "제안값을 계약에 적용할 수 없습니다."
    );
  }
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    const updated = await updateContractRow(
      {
        organizationId: authContext.organizationId,
        contractId: contract.id,
        data: {
          title: data.title,
          contractNumber: data.contractNumber ?? null,
          contractType: data.contractType,
          status: data.status,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          signedDate: data.signedDate ?? null,
          autoRenewal: data.autoRenewal,
          noticePeriodDays: data.noticePeriodDays ?? null,
          amount: data.amount ? new Prisma.Decimal(data.amount) : null,
          currency: data.currency,
          governingLaw: data.governingLaw ?? null,
          jurisdiction: data.jurisdiction ?? null,
          description: data.description ?? null,
          counterpartyId: data.counterpartyId ?? null,
        },
      },
      tx
    );
    if (!updated) {
      throw new NotFoundError();
    }

    await updateExtractionJob(
      {
        jobId: job.id,
        data: { status: ExtractionJobStatus.COMPLETED, completedAt: new Date() },
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Contract",
        entityId: contract.id,
        action: AUDIT_ACTIONS.EXTRACTION_APPLIED,
        metadata: { jobId: job.id, contractId: contract.id, fieldKeys: appliedFieldKeys },
      },
    });
  });

  return { appliedFieldCount: appliedFieldKeys.length };
}
