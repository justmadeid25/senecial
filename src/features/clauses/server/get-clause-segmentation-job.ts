import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseSegmentationJobById } from "@/server/repositories/clause-segmentation-job-repository";
import { countClausesBySegmentationJobId } from "@/server/repositories/contract-clause-repository";

export interface ClauseSegmentationJobDetail {
  id: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  extractedDocumentId: string;
  segmenterVersion: string;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  clauseCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
}

export interface GetClauseSegmentationJobParams {
  userId: string;
  organizationId: string;
  contractId: string;
  jobId: string;
}

/** storageKey/document text are never included - only counts and status. */
export async function getClauseSegmentationJob(
  params: GetClauseSegmentationJobParams
): Promise<ClauseSegmentationJobDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const job = await findClauseSegmentationJobById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    jobId: params.jobId,
  });
  if (!job) {
    throw new NotFoundError();
  }

  const clauseCount = await countClausesBySegmentationJobId({
    organizationId: authContext.organizationId,
    segmentationJobId: job.id,
  });

  const warnings = Array.isArray(job.warnings)
    ? job.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    extractedDocumentId: job.extractedDocumentId,
    segmenterVersion: job.segmenterVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    warnings,
    clauseCount,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
  };
}
