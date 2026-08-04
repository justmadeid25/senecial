import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";
import type { ClauseType } from "@/generated/prisma/enums";
import { hasHierarchyCycle, isValidParentReference } from "@/domain/clauses/hierarchy-validation";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { isOffsetRangeValid } from "@/domain/clauses/offset-validation";
import { SEGMENTATION_ERROR_CODES } from "@/domain/clauses/segmentation-error-codes";
import { InvalidSegmentationResultError } from "@/domain/clauses/segmentation-errors";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { clauseSegmentationResultSchema } from "@/lib/validation/clauses";
import {
  claimNextPendingClauseSegmentationJob,
  updateClauseSegmentationJob,
  type ClauseSegmentationJobRow,
} from "@/server/repositories/clause-segmentation-job-repository";
import { findExtractedDocumentById } from "@/server/repositories/extracted-document-repository";
import { createContractSections } from "@/server/repositories/contract-section-repository";
import {
  createContractClauses,
  type CreateContractClauseData,
} from "@/server/repositories/contract-clause-repository";
import { getClauseClassifier, getClauseSegmenter } from "@/server/services/clauses";
import { prisma } from "@/server/db/client";
import { computeChecksum } from "@/server/storage";
import { enqueueEmbeddingJobsForClauses } from "@/features/ai/server/enqueue-embedding-jobs";

const ALL_CLAUSE_TYPES: ClauseType[] = [
  "DEFINITIONS",
  "TERM",
  "TERMINATION",
  "PAYMENT",
  "PRICE_ADJUSTMENT",
  "SCOPE_OF_WORK",
  "DELIVERY",
  "ACCEPTANCE",
  "WARRANTY",
  "LIABILITY",
  "LIMITATION_OF_LIABILITY",
  "INDEMNITY",
  "CONFIDENTIALITY",
  "INTELLECTUAL_PROPERTY",
  "DATA_PROTECTION",
  "SECURITY",
  "NON_COMPETE",
  "NON_SOLICITATION",
  "AUTO_RENEWAL",
  "NOTICE",
  "FORCE_MAJEURE",
  "GOVERNING_LAW",
  "JURISDICTION",
  "DISPUTE_RESOLUTION",
  "ASSIGNMENT",
  "CHANGE_CONTROL",
  "AUDIT_RIGHTS",
  "COMPLIANCE",
  "INSURANCE",
  "SUBCONTRACTING",
  "OTHER",
  "UNKNOWN",
];

export interface ProcessNextClauseSegmentationJobResult {
  processed: boolean;
  jobId?: string;
}

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/process-clause-segmentation-jobs.ts), same pattern as Phase 6's
 * processNextExtractionJob().
 */
export async function processNextClauseSegmentationJob(
  workerId: string
): Promise<ProcessNextClauseSegmentationJobResult> {
  const job = await claimNextPendingClauseSegmentationJob(workerId);
  if (!job) {
    return { processed: false };
  }

  await runClaimedJob(job);
  return { processed: true, jobId: job.id };
}

async function failJob(jobId: string, errorCode: string, safeErrorMessage: string): Promise<void> {
  await updateClauseSegmentationJob({
    jobId,
    data: {
      status: ClauseSegmentationJobStatus.FAILED,
      failedAt: new Date(),
      errorCode,
      errorMessage: safeErrorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });

  const job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.auditLog.create({
    data: {
      organizationId: job.organizationId,
      userId: null,
      entityType: "ClauseSegmentationJob",
      entityId: job.id,
      action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_FAILED,
      metadata: { jobId: job.id, contractId: job.contractId, errorCode },
    },
  });
}

async function runClaimedJob(job: ClauseSegmentationJobRow): Promise<void> {
  const document = await findExtractedDocumentById({
    organizationId: job.organizationId,
    contractId: job.contractId,
    extractedDocumentId: job.extractedDocumentId,
  });
  if (!document) {
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.EXTRACTED_DOCUMENT_NOT_FOUND,
      "추출된 문서를 찾을 수 없습니다."
    );
    return;
  }

  const actualChecksum = computeChecksum(Buffer.from(document.text, "utf8"));
  if (actualChecksum !== document.contentChecksum || actualChecksum !== job.inputChecksum) {
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.DOCUMENT_CHECKSUM_MISMATCH,
      "문서 내용이 작업 생성 시점과 달라졌습니다."
    );
    return;
  }

  let result;
  try {
    const rawResult = await getClauseSegmenter().segment({ text: document.text, locale: "ko-KR" });
    const validated = clauseSegmentationResultSchema.safeParse(rawResult);
    if (!validated.success) {
      throw new InvalidSegmentationResultError();
    }
    result = validated.data;
  } catch (error) {
    if (error instanceof InvalidSegmentationResultError) {
      await failJob(
        job.id,
        SEGMENTATION_ERROR_CODES.INVALID_SEGMENTATION_RESULT,
        "조항 분해 결과 형식이 올바르지 않습니다."
      );
      return;
    }
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.SEGMENTATION_FAILED,
      "조항 분해 중 오류가 발생했습니다."
    );
    return;
  }

  // Every section/clause must be an exact substring of the document at its
  // recorded offsets - a segmenter bug here fails the whole job rather
  // than saving a partially-wrong position (§5, §12).
  const offsetsValid =
    result.sections.every((section) =>
      isOffsetRangeValid(document.text, section.startOffset, section.endOffset, section.text)
    ) &&
    result.clauses.every((clause) =>
      isOffsetRangeValid(document.text, clause.startOffset, clause.endOffset, clause.text)
    );
  if (!offsetsValid) {
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.INVALID_OFFSETS,
      "조항 원문 위치가 올바르지 않아 처리를 중단했습니다."
    );
    return;
  }

  const orderIndexes = new Set(result.clauses.map((clause) => clause.orderIndex));
  const hierarchyNodes = result.clauses.map((clause) => ({
    orderIndex: clause.orderIndex,
    parentOrderIndex: clause.parentOrderIndex,
  }));
  const hierarchyValid =
    hierarchyNodes.every((node) => isValidParentReference(node, orderIndexes)) &&
    !hasHierarchyCycle(hierarchyNodes);
  if (!hierarchyValid) {
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.INVALID_HIERARCHY,
      "조항 계층 구조가 올바르지 않아 처리를 중단했습니다."
    );
    return;
  }

  let classificationByOrderIndex: Map<
    number,
    { suggestedType: ClauseType; confidence?: number; matchedSignals: string[] }
  >;
  try {
    const classifier = getClauseClassifier();
    const entries = await Promise.all(
      result.clauses.map(async (clause) => {
        const classification = await classifier.classify({
          clauseText: clause.text,
          clauseTitle: clause.title,
          allowedTypes: ALL_CLAUSE_TYPES,
          locale: "ko-KR",
        });
        return [clause.orderIndex, classification] as const;
      })
    );
    classificationByOrderIndex = new Map(entries);
  } catch {
    await failJob(
      job.id,
      SEGMENTATION_ERROR_CODES.CLASSIFICATION_FAILED,
      "조항 유형 분류 중 오류가 발생했습니다."
    );
    return;
  }

  // Only ONE section exists per segmentation job in this Phase's MVP
  // implementation (see DeterministicKoreanClauseSegmenter) - pre-generate
  // its id so clauses can reference it before the section row is inserted.
  const sectionIdByOrderIndex = new Map(result.sections.map((section) => [section.orderIndex, randomUUID()]));
  const clauseIdByOrderIndex = new Map(result.clauses.map((clause) => [clause.orderIndex, randomUUID()]));

  const sectionRows = result.sections.map((section) => ({
    id: sectionIdByOrderIndex.get(section.orderIndex)!,
    organizationId: job.organizationId,
    contractId: job.contractId,
    extractedDocumentId: job.extractedDocumentId,
    segmentationJobId: job.id,
    title: section.title ?? null,
    sectionType: section.sectionType ?? null,
    orderIndex: section.orderIndex,
    startOffset: section.startOffset,
    endOffset: section.endOffset,
    text: section.text,
  }));

  const defaultSectionId = result.sections[0] ? sectionIdByOrderIndex.get(result.sections[0].orderIndex) : undefined;

  const clauseRows: CreateContractClauseData[] = result.clauses.map((clause) => {
    const classification = classificationByOrderIndex.get(clause.orderIndex);
    return {
      id: clauseIdByOrderIndex.get(clause.orderIndex)!,
      organizationId: job.organizationId,
      contractId: job.contractId,
      extractedDocumentId: job.extractedDocumentId,
      segmentationJobId: job.id,
      sectionId: defaultSectionId ?? null,
      parentClauseId:
        clause.parentOrderIndex !== undefined
          ? (clauseIdByOrderIndex.get(clause.parentOrderIndex) ?? null)
          : null,
      clauseNumber: clause.clauseNumber ?? null,
      title: clause.title ?? null,
      text: clause.text,
      normalizedText: normalizeClauseText(clause.text),
      orderIndex: clause.orderIndex,
      depth: clause.depth,
      startOffset: clause.startOffset,
      endOffset: clause.endOffset,
      suggestedClauseType: classification?.suggestedType ?? null,
      classificationConfidence:
        classification?.confidence !== undefined
          ? new Prisma.Decimal(classification.confidence.toFixed(2))
          : null,
      classificationSignals: classification?.matchedSignals ?? [],
    };
  });

  await prisma.$transaction(async (tx) => {
    await createContractSections(sectionRows, tx);
    await createContractClauses(clauseRows, tx);

    await updateClauseSegmentationJob(
      {
        jobId: job.id,
        data: {
          status: ClauseSegmentationJobStatus.REVIEW_REQUIRED,
          completedAt: new Date(),
          warnings: result.warnings,
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
        entityType: "ClauseSegmentationJob",
        entityId: job.id,
        action: AUDIT_ACTIONS.CLAUSE_SEGMENTATION_REVIEW_REQUIRED,
        metadata: { jobId: job.id, contractId: job.contractId, clauseCount: clauseRows.length },
      },
    });
  });

  // §Embedding Pipeline - best-effort, outside the transaction above (a
  // failure here must never fail the segmentation job itself - see
  // enqueueEmbeddingJobsForClauses()'s own docstring). Uses the same
  // pre-generated ids/organizationId/normalizedText already computed for
  // clauseRows above, so no re-query is needed.
  try {
    await enqueueEmbeddingJobsForClauses(
      clauseRows.map((row) => ({ id: row.id, organizationId: row.organizationId, normalizedText: row.normalizedText }))
    );
  } catch (error) {
    console.error(
      `Failed to enqueue embedding jobs for segmentation job ${job.id}:`,
      error instanceof Error ? error.message : error
    );
  }
}
