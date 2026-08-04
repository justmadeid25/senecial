import { EXTRACTOR_VERSION } from "@/domain/extraction/extractor-version";
import { isRetryableExtractionError } from "@/domain/extraction/extraction-error-codes";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { EXTRACTION_MAX_ATTEMPTS } from "@/lib/config/extraction";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createExtractionJobSchema } from "@/lib/validation/extraction";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";
import { findContractFileById } from "@/server/repositories/contract-file-repository";
import {
  createExtractionJob as createExtractionJobRow,
  findExtractionJobByDedupKey,
  resetExtractionJobToPending,
} from "@/server/repositories/extraction-job-repository";
import { prisma } from "@/server/db/client";

export interface CreateExtractionJobParams {
  userId: string;
  organizationId: string;
  contractId: string;
  input: unknown;
}

export interface CreatedExtractionJob {
  jobId: string;
}

/**
 * OWNER and MEMBER can both request extraction - only membership is
 * required, matching the file-upload policy.
 *
 * Deliberately does NOT read the file's bytes from storage - only its
 * already-computed ContractFile.checksum (set at upload time). This keeps
 * job creation fast (§20's "작업 생성 요청은 빠르게 끝나야 합니다"); the
 * actual file read + checksum re-verification happens in the worker
 * (process-extraction-job.ts), which also protects against the file
 * changing between job creation and processing.
 */
export async function createExtractionJob(
  params: CreateExtractionJobParams
): Promise<CreatedExtractionJob> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = createExtractionJobSchema.safeParse(params.input);
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

  const file = await findContractFileById({
    organizationId: authContext.organizationId,
    contractId: contract.id,
    fileId: parsed.data.contractFileId,
  });
  if (!file) {
    throw new NotFoundError();
  }

  const existing = await findExtractionJobByDedupKey({
    organizationId: authContext.organizationId,
    contractFileId: file.id,
    inputChecksum: file.checksum,
    extractorVersion: EXTRACTOR_VERSION,
  });

  if (!existing) {
    const created = await prisma.$transaction(async (tx) => {
      const job = await createExtractionJobRow(
        {
          organizationId: authContext.organizationId,
          contractId: contract.id,
          contractFileId: file.id,
          extractorVersion: EXTRACTOR_VERSION,
          inputChecksum: file.checksum,
          createdById: authContext.userId,
          maxAttempts: EXTRACTION_MAX_ATTEMPTS,
        },
        tx
      );

      await tx.auditLog.create({
        data: {
          organizationId: authContext.organizationId,
          userId: authContext.userId,
          entityType: "ContractExtractionJob",
          entityId: job.id,
          action: AUDIT_ACTIONS.EXTRACTION_JOB_CREATED,
          metadata: { jobId: job.id, contractId: contract.id, contractFileId: file.id },
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
      throw new ConflictError("이 파일에 대해 이미 진행 중인 추출 작업이 있습니다.");

    case "COMPLETED":
      throw new ConflictError("이 파일에 대한 추출이 이미 완료되었습니다.");

    case "CANCELLED":
      throw new ConflictError("이 파일에 대한 추출 작업이 취소되었습니다.");

    case "FAILED": {
      if (!isRetryableExtractionError(existing.errorCode ?? "", existing.attempt, existing.maxAttempts)) {
        throw new ConflictError(
          "이 파일에 대한 추출 작업이 재시도할 수 없는 상태로 실패했습니다 (최대 재시도 횟수 초과 또는 지원하지 않는 형식)."
        );
      }

      const reset = await prisma.$transaction(async (tx) => {
        const job = await resetExtractionJobToPending(existing.id, tx);

        await tx.auditLog.create({
          data: {
            organizationId: authContext.organizationId,
            userId: authContext.userId,
            entityType: "ContractExtractionJob",
            entityId: job.id,
            action: AUDIT_ACTIONS.EXTRACTION_RETRY_REQUESTED,
            metadata: { jobId: job.id, contractId: contract.id, contractFileId: file.id },
          },
        });

        return job;
      });

      return { jobId: reset.id };
    }

    default:
      throw new ConflictError("이 파일에 대한 추출 작업 상태를 확인할 수 없습니다.");
  }
}
