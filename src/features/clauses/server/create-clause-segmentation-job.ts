import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { isRetryableSegmentationError } from "@/domain/clauses/segmentation-error-codes";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { CLAUSE_SEGMENTATION_MAX_ATTEMPTS } from "@/lib/config/clause-segmentation";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createClauseSegmentationJobSchema } from "@/lib/validation/clauses";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";
import { findExtractedDocumentById } from "@/server/repositories/extracted-document-repository";
import {
  createClauseSegmentationJob as createClauseSegmentationJobRow,
  findClauseSegmentationJobByKey,
  resetClauseSegmentationJobToPending,
} from "@/server/repositories/clause-segmentation-job-repository";
import { computeChecksum } from "@/server/storage";
import { prisma } from "@/server/db/client";

export interface CreateClauseSegmentationJobParams {
  userId: string;
  organizationId: string;
  contractId: string;
  input: unknown;
}

export interface CreatedClauseSegmentationJob {
  jobId: string;
}

function buildJobKey(extractedDocumentId: string, inputChecksum: string, segmenterVersion: string): string {
  return computeChecksum(Buffer.from(`${extractedDocumentId}:${inputChecksum}:${segmenterVersion}`, "utf8"));
}

/**
 * OWNER and MEMBER can both request segmentation - only membership is
 * required, matching Phase 6's create-extraction-job.ts policy.
 *
 * Like Phase 6, this does NOT re-read or re-process the document text at
 * request time - it only reuses the already-computed
 * ContractExtractedDocument.contentChecksum, keeping job creation fast.
 */
export async function createClauseSegmentationJob(
  params: CreateClauseSegmentationJobParams
): Promise<CreatedClauseSegmentationJob> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = createClauseSegmentationJobSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  const contract = await findContractById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
  if (!contract) {
    throw new NotFoundError();
  }

  const document = await findExtractedDocumentById({
    organizationId: authContext.organizationId,
    contractId: contract.id,
    extractedDocumentId: parsed.data.extractedDocumentId,
  });
  if (!document) {
    throw new NotFoundError();
  }

  const jobKey = buildJobKey(document.id, document.contentChecksum, CLAUSE_SEGMENTER_VERSION);
  const existing = await findClauseSegmentationJobByKey({
    organizationId: authContext.organizationId,
    jobKey,
  });

  if (!existing) {
    const created = await prisma.$transaction(async (tx) => {
      const job = await createClauseSegmentationJobRow(
        {
          organizationId: authContext.organizationId,
          contractId: contract.id,
          extractedDocumentId: document.id,
          segmenterVersion: CLAUSE_SEGMENTER_VERSION,
          inputChecksum: document.contentChecksum,
          jobKey,
          createdById: authContext.userId,
          maxAttempts: CLAUSE_SEGMENTATION_MAX_ATTEMPTS,
        },
        tx
      );

      await tx.auditLog.create({
        data: {
          organizationId: authContext.organizationId,
          userId: authContext.userId,
          entityType: "ClauseSegmentationJob",
          entityId: job.id,
          action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_JOB_CREATED,
          metadata: { jobId: job.id, contractId: contract.id },
        },
      });

      return job;
    });

    return { jobId: created.id };
  }

  switch (existing.status) {
    case "PENDING":
    case "PROCESSING":
    case "REVIEW_REQUIRED":
      throw new ConflictError("이 문서에 대해 이미 진행 중인 조항 분해 작업이 있습니다.");

    case "COMPLETED":
      throw new ConflictError("이 문서에 대한 조항 분해가 이미 완료되었습니다.");

    case "CANCELLED":
      throw new ConflictError("이 문서에 대한 조항 분해 작업이 취소되었습니다.");

    case "FAILED": {
      if (
        !isRetryableSegmentationError(existing.errorCode ?? "", existing.attempt, existing.maxAttempts)
      ) {
        throw new ConflictError(
          "이 문서에 대한 조항 분해 작업이 재시도할 수 없는 상태로 실패했습니다 (최대 재시도 횟수 초과 또는 유효하지 않은 결과)."
        );
      }

      const reset = await prisma.$transaction(async (tx) => {
        const job = await resetClauseSegmentationJobToPending(existing.id, tx);

        await tx.auditLog.create({
          data: {
            organizationId: authContext.organizationId,
            userId: authContext.userId,
            entityType: "ClauseSegmentationJob",
            entityId: job.id,
            action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_RETRY_REQUESTED,
            metadata: { jobId: job.id, contractId: contract.id },
          },
        });

        return job;
      });

      return { jobId: reset.id };
    }

    default:
      throw new ConflictError("이 문서에 대한 조항 분해 작업 상태를 확인할 수 없습니다.");
  }
}
