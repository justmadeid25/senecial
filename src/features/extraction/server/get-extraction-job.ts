import type { ContractExtractableField } from "@/domain/extraction/extractable-fields";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractFileById } from "@/server/repositories/contract-file-repository";
import { findExtractedDocumentByJobId } from "@/server/repositories/extracted-document-repository";
import { findExtractionJobById } from "@/server/repositories/extraction-job-repository";
import { findSuggestionsByJobId } from "@/server/repositories/field-suggestion-repository";

export interface SuggestionDetail {
  id: string;
  fieldKey: ContractExtractableField;
  rawValue: string | null;
  normalizedValue: unknown;
  confidence: number | null;
  sourceText: string | null;
  sourcePage: number | null;
  reviewStatus: "PENDING" | "ACCEPTED" | "REJECTED" | "EDITED";
  reviewedValue: unknown;
}

export interface ExtractionJobDetail {
  id: string;
  status: string;
  stage: string | null;
  attempt: number;
  maxAttempts: number;
  provider: string | null;
  extractorVersion: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  contractFileId: string;
  contractFileName: string;
  extractionMethod: string | null;
  pageCount: number | null;
  characterCount: number | null;
  warnings: string[];
  suggestions: SuggestionDetail[];
}

export interface GetExtractionJobParams {
  userId: string;
  organizationId: string;
  contractId: string;
  jobId: string;
}

/** storageKey is never included - the review screen has no legitimate use for it. */
export async function getExtractionJob(params: GetExtractionJobParams): Promise<ExtractionJobDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const job = await findExtractionJobById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    jobId: params.jobId,
  });
  if (!job) {
    throw new NotFoundError();
  }

  const [file, suggestions, extractedDocument] = await Promise.all([
    findContractFileById({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
      fileId: job.contractFileId,
    }),
    findSuggestionsByJobId({ organizationId: authContext.organizationId, extractionJobId: job.id }),
    findExtractedDocumentByJobId({ organizationId: authContext.organizationId, extractionJobId: job.id }),
  ]);

  const warnings = Array.isArray(job.warnings)
    ? job.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    provider: job.provider,
    extractorVersion: job.extractorVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    contractFileId: job.contractFileId,
    contractFileName: file?.originalName ?? "(삭제된 파일)",
    extractionMethod: extractedDocument?.extractionMethod ?? null,
    pageCount: extractedDocument?.pageCount ?? null,
    characterCount: extractedDocument?.characterCount ?? null,
    warnings,
    suggestions: suggestions.map((suggestion) => ({
      id: suggestion.id,
      fieldKey: suggestion.fieldKey as ContractExtractableField,
      rawValue: suggestion.rawValue,
      normalizedValue: suggestion.normalizedValue,
      confidence: suggestion.confidence ? Number(suggestion.confidence) : null,
      sourceText: suggestion.sourceText,
      sourcePage: suggestion.sourcePage,
      reviewStatus: suggestion.reviewStatus,
      reviewedValue: suggestion.reviewedValue,
    })),
  };
}
