import type { ClauseType } from "@/generated/prisma/enums";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseSegmentationJobsByContract } from "@/server/repositories/clause-segmentation-job-repository";
import {
  countClausesBySegmentationJobId,
  findClausesBySegmentationJobId,
  type ContractClauseRow,
} from "@/server/repositories/contract-clause-repository";

export interface ClauseListItem {
  id: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  depth: number;
  orderIndex: number;
  parentClauseId: string | null;
  suggestedClauseType: ClauseType | null;
  reviewedClauseType: ClauseType | null;
  classificationState: string;
  classificationConfidence: number | null;
}

export interface ListContractClausesParams {
  userId: string;
  organizationId: string;
  contractId: string;
  jobId?: string;
  page?: number;
  pageSize?: number;
}

export interface ListContractClausesResult {
  jobId: string | null;
  clauses: ClauseListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function toListItem(row: ContractClauseRow): ClauseListItem {
  return {
    id: row.id,
    clauseNumber: row.clauseNumber,
    title: row.title,
    text: row.text,
    depth: row.depth,
    orderIndex: row.orderIndex,
    parentClauseId: row.parentClauseId,
    suggestedClauseType: row.suggestedClauseType,
    reviewedClauseType: row.reviewedClauseType,
    classificationState: row.classificationState,
    classificationConfidence: row.classificationConfidence ? Number(row.classificationConfidence) : null,
  };
}

/**
 * Defaults to the most recently READY (REVIEW_REQUIRED or COMPLETED) job
 * for the contract when no jobId is given - older segmentation jobs and
 * their clauses are preserved but are not the default view (§12's
 * revision-preservation requirement).
 */
export async function listContractClauses(
  params: ListContractClausesParams
): Promise<ListContractClausesResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 30;

  let jobId = params.jobId ?? null;
  if (!jobId) {
    const jobs = await findClauseSegmentationJobsByContract({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
    });
    jobId =
      jobs.find((job) => job.status === "REVIEW_REQUIRED" || job.status === "COMPLETED")?.id ?? null;
  }

  if (!jobId) {
    return { jobId: null, clauses: [], total: 0, page, pageSize, totalPages: 0 };
  }

  const [rows, total] = await Promise.all([
    findClausesBySegmentationJobId({
      organizationId: authContext.organizationId,
      segmentationJobId: jobId,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    countClausesBySegmentationJobId({
      organizationId: authContext.organizationId,
      segmentationJobId: jobId,
    }),
  ]);

  return {
    jobId,
    clauses: rows.map(toListItem),
    total,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
