import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseSegmentationJobsByContract } from "@/server/repositories/clause-segmentation-job-repository";
import { listExtractedDocumentsByContract } from "@/server/repositories/extracted-document-repository";

export interface ClauseSegmentationJobListItem {
  id: string;
  status: string;
  extractedDocumentId: string;
  extractedDocumentLabel: string;
  createdAt: Date;
  errorCode: string | null;
}

export interface ListClauseSegmentationJobsParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

/** Newest first - the UI treats jobs[0] per extractedDocumentId as the "latest" revision to show by default (older jobs remain queryable but aren't the default view). */
export async function listClauseSegmentationJobs(
  params: ListClauseSegmentationJobsParams
): Promise<ClauseSegmentationJobListItem[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const [jobs, documents] = await Promise.all([
    findClauseSegmentationJobsByContract({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
    }),
    listExtractedDocumentsByContract({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
    }),
  ]);

  const documentLabelById = new Map(
    documents.map((document, index) => [document.id, `추출 문서 ${documents.length - index}`])
  );

  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    extractedDocumentId: job.extractedDocumentId,
    extractedDocumentLabel: documentLabelById.get(job.extractedDocumentId) ?? "추출 문서",
    createdAt: job.createdAt,
    errorCode: job.errorCode,
  }));
}

/** Latest (by createdAt) job per extractedDocumentId - what the clause list/review screens show by default. */
export function pickLatestJobPerDocument(
  jobs: ClauseSegmentationJobListItem[]
): ClauseSegmentationJobListItem[] {
  const latestByDocument = new Map<string, ClauseSegmentationJobListItem>();
  for (const job of jobs) {
    const existing = latestByDocument.get(job.extractedDocumentId);
    if (!existing || job.createdAt > existing.createdAt) {
      latestByDocument.set(job.extractedDocumentId, job);
    }
  }
  return [...latestByDocument.values()];
}
