import path from "node:path";

import { Prisma } from "@/generated/prisma/client";
import { ExtractionJobStatus, ExtractionStage } from "@/generated/prisma/enums";
import { CONTRACT_EXTRACTABLE_FIELDS } from "@/domain/extraction/extractable-fields";
import { EXTRACTION_ERROR_CODES } from "@/domain/extraction/extraction-error-codes";
import { OcrRequiredError, UnsupportedFormatError } from "@/domain/extraction/extraction-errors";
import { isValidNormalizedSuggestionValue } from "@/domain/extraction/validate-normalized-suggestion-value";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { contractFieldExtractionResultSchema } from "@/lib/validation/extraction";
import { createDocumentChunksForExtractedDocument } from "@/features/ai/server/create-document-chunks-for-extracted-document";
import { findContractFileById } from "@/server/repositories/contract-file-repository";
import { findContractById } from "@/server/repositories/contract-repository";
import {
  claimNextPendingJob,
  updateExtractionJob,
  type ExtractionJobRow,
} from "@/server/repositories/extraction-job-repository";
import { createExtractedDocument } from "@/server/repositories/extracted-document-repository";
import {
  createFieldSuggestions,
  deleteSuggestionsByJobId,
} from "@/server/repositories/field-suggestion-repository";
import { prisma } from "@/server/db/client";
import { getContractFieldExtractionService, getDocumentTextExtractor } from "@/server/services/extraction";
import { computeChecksum, getStorageDriverForProvider, resolveStorageProvider } from "@/server/storage";

export interface ProcessNextExtractionJobResult {
  processed: boolean;
  jobId?: string;
}

/**
 * No auth check by design - like the notification/reconciliation CLIs
 * (Phase 5), this is a trusted batch entry point invoked only from
 * scripts/process-extraction-jobs.ts, never from a Server Action or HTTP
 * route.
 */
export async function processNextExtractionJob(
  workerId: string
): Promise<ProcessNextExtractionJobResult> {
  const job = await claimNextPendingJob(workerId);
  if (!job) {
    return { processed: false };
  }

  await runClaimedJob(job);
  return { processed: true, jobId: job.id };
}

/**
 * errorMessage is always a short, pre-written safe string here - never the
 * raw caught error's message for unexpected exceptions (which could
 * contain a Prisma error, a file path, or other internal detail). The
 * document text and any provider response are never included either.
 */
async function failJob(jobId: string, errorCode: string, safeErrorMessage: string): Promise<void> {
  await updateExtractionJob({
    jobId,
    data: {
      status: ExtractionJobStatus.FAILED,
      failedAt: new Date(),
      errorCode,
      errorMessage: safeErrorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });

  const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      userId: null,
      entityType: "ContractExtractionJob",
      entityId: job.id,
      action: AUDIT_ACTIONS.EXTRACTION_JOB_FAILED,
      metadata: { jobId: job.id, contractId: job.contractId, errorCode },
    },
  });
}

async function runClaimedJob(job: ExtractionJobRow): Promise<void> {
  const contract = await findContractById({
    organizationId: job.organizationId,
    contractId: job.contractId,
  });
  const file = contract
    ? await findContractFileById({
        organizationId: job.organizationId,
        contractId: job.contractId,
        fileId: job.contractFileId,
      })
    : null;

  if (!contract || !file) {
    await failJob(job.id, EXTRACTION_ERROR_CODES.FILE_NOT_FOUND, "파일 또는 계약을 찾을 수 없습니다.");
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await getStorageDriverForProvider(resolveStorageProvider(file.storageProvider)).getBuffer(file.storageKey);
  } catch {
    await failJob(job.id, EXTRACTION_ERROR_CODES.FILE_NOT_FOUND, "저장소에서 파일을 읽을 수 없습니다.");
    return;
  }

  // Re-verify against the checksum captured at job-creation time - the
  // file (a new upload with the same name is impossible here since
  // storageKey is random, but this also guards against any future path
  // where a file's bytes could otherwise change under the same row).
  const actualChecksum = computeChecksum(buffer);
  if (actualChecksum !== job.inputChecksum) {
    await failJob(
      job.id,
      EXTRACTION_ERROR_CODES.CHECKSUM_MISMATCH,
      "파일 내용이 작업 생성 시점과 달라졌습니다."
    );
    return;
  }

  const extension = path.extname(file.originalName).toLowerCase();

  let extracted;
  try {
    extracted = await getDocumentTextExtractor().extract({
      buffer,
      originalName: file.originalName,
      mimeType: file.mimeType,
      extension,
    });
  } catch (error) {
    if (error instanceof OcrRequiredError) {
      await failJob(job.id, EXTRACTION_ERROR_CODES.OCR_REQUIRED, error.message);
      return;
    }
    if (error instanceof UnsupportedFormatError) {
      await failJob(job.id, EXTRACTION_ERROR_CODES.UNSUPPORTED_FORMAT, error.message);
      return;
    }
    await failJob(
      job.id,
      EXTRACTION_ERROR_CODES.TEXT_EXTRACTION_FAILED,
      "문서 텍스트 추출 중 오류가 발생했습니다."
    );
    return;
  }

  await updateExtractionJob({
    jobId: job.id,
    data: { stage: ExtractionStage.CONTRACT_FIELD_EXTRACTION },
  });

  let fieldResult;
  try {
    const rawResult = await getContractFieldExtractionService().extract({
      documentText: extracted.text,
      locale: "ko-KR",
      allowedFields: CONTRACT_EXTRACTABLE_FIELDS,
    });
    const validated = contractFieldExtractionResultSchema.safeParse(rawResult);
    if (!validated.success) {
      await failJob(
        job.id,
        EXTRACTION_ERROR_CODES.INVALID_PROVIDER_RESPONSE,
        "추출 결과 형식이 올바르지 않습니다."
      );
      return;
    }
    fieldResult = validated.data;
  } catch {
    await failJob(
      job.id,
      EXTRACTION_ERROR_CODES.FIELD_EXTRACTION_FAILED,
      "핵심정보 추출 중 오류가 발생했습니다."
    );
    return;
  }

  const suggestionRows = fieldResult.fields
    .filter((field) => isValidNormalizedSuggestionValue(field.fieldKey, field.normalizedValue))
    .map((field) => ({
      extractionJobId: job.id,
      organizationId: job.organizationId,
      contractId: job.contractId,
      fieldKey: field.fieldKey,
      rawValue: field.rawValue ?? null,
      normalizedValue: field.normalizedValue as Prisma.InputJsonValue,
      confidence:
        field.confidence !== undefined ? new Prisma.Decimal(field.confidence.toFixed(2)) : null,
      sourceText: field.sourceText ?? null,
      sourcePage: field.sourcePage ?? null,
    }));

  const contentChecksum = computeChecksum(Buffer.from(extracted.text, "utf8"));

  const extractedDocument = await prisma.$transaction(async (tx) => {
    // Re-processing (REVIEW_REQUIRED -> PROCESSING) clears prior
    // suggestions/document rather than keeping revision history - see
    // field-suggestion-repository.ts's deleteSuggestionsByJobId comment.
    await deleteSuggestionsByJobId(job.id, tx);

    const existingDocument = await tx.contractExtractedDocument.findUnique({
      where: { extractionJobId: job.id },
    });
    if (existingDocument) {
      await tx.contractExtractedDocument.delete({ where: { id: existingDocument.id } });
    }

    const createdDocument = await createExtractedDocument(
      {
        extractionJobId: job.id,
        organizationId: job.organizationId,
        contractId: job.contractId,
        contractFileId: job.contractFileId,
        text: extracted.text,
        characterCount: extracted.text.length,
        pageCount: extracted.pageCount ?? null,
        language: extracted.language ?? null,
        extractionMethod: extracted.method,
        contentChecksum,
      },
      tx
    );

    await createFieldSuggestions(suggestionRows, tx);

    await updateExtractionJob(
      {
        jobId: job.id,
        data: {
          status: ExtractionJobStatus.REVIEW_REQUIRED,
          stage: ExtractionStage.READY_FOR_REVIEW,
          completedAt: new Date(),
          contractUpdatedAtSnapshot: contract.updatedAt,
          warnings: [...extracted.warnings, ...fieldResult.warnings],
          lockedAt: null,
          lockedBy: null,
        },
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: job.organizationId,
        userId: null,
        entityType: "ContractExtractionJob",
        entityId: job.id,
        action: AUDIT_ACTIONS.EXTRACTION_REVIEW_REQUIRED,
        metadata: {
          jobId: job.id,
          contractId: job.contractId,
          fieldKeys: suggestionRows.map((row) => row.fieldKey),
        },
      },
    });

    return createdDocument;
  });

  // §Phase 14.1 §4/§11 - best-effort, outside the transaction above (a
  // failure here must never fail the extraction job itself - raw
  // retrieval simply stays unavailable for this document until the next
  // successful re-extraction or a manual re-chunk, same "never block the
  // feature this is downstream of" discipline as
  // enqueueEmbeddingJobsForClauses() in the segmentation job).
  try {
    await createDocumentChunksForExtractedDocument({
      organizationId: job.organizationId,
      contractId: job.contractId,
      extractedDocumentId: extractedDocument.id,
      text: extracted.text,
    });
  } catch (error) {
    console.error(
      `Failed to create document chunks for extraction job ${job.id}:`,
      error instanceof Error ? error.message : error
    );
  }
}
