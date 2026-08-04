import { buildSearchSnippet, type SearchSnippet } from "@/domain/clauses/search-snippet";
import { ValidationError } from "@/lib/errors";
import { clauseSearchQuerySchema } from "@/lib/validation/clauses";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findClauseSegmentationJobsByContract } from "@/server/repositories/clause-segmentation-job-repository";
import {
  countSearchContractClauses,
  searchContractClauses,
} from "@/server/repositories/contract-clause-repository";

export interface ClauseSearchResultItem {
  id: string;
  contractId: string;
  clauseNumber: string | null;
  title: string | null;
  clauseType: string | null;
  snippet: SearchSnippet | null;
}

export interface SearchContractClausesParams {
  userId: string;
  organizationId: string;
  contractId: string;
  input: unknown;
}

export interface SearchContractClausesResult {
  items: ClauseSearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Only the latest ready job per document is searched by default - stale/superseded revisions are excluded (§12, §38). */
async function latestReadyJobIdsForContract(
  organizationId: string,
  contractId: string
): Promise<string[]> {
  const jobs = await findClauseSegmentationJobsByContract({ organizationId, contractId });
  const latestByDocument = new Map<string, string>();
  for (const job of jobs) {
    if (job.status !== "REVIEW_REQUIRED" && job.status !== "COMPLETED") {
      continue;
    }
    if (!latestByDocument.has(job.extractedDocumentId)) {
      latestByDocument.set(job.extractedDocumentId, job.id);
    }
  }
  return [...latestByDocument.values()];
}

export async function searchContractClausesInContract(
  params: SearchContractClausesParams
): Promise<SearchContractClausesResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = clauseSearchQuerySchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "검색어를 입력해 주세요.");
  }

  const latestJobIds = await latestReadyJobIdsForContract(authContext.organizationId, params.contractId);
  if (latestJobIds.length === 0) {
    return { items: [], total: 0, page: parsed.data.page, pageSize: parsed.data.pageSize, totalPages: 0 };
  }

  const searchParams = {
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    query: parsed.data.q,
    clauseType: parsed.data.clauseType,
    latestJobIdsByContract: latestJobIds,
    skip: (parsed.data.page - 1) * parsed.data.pageSize,
    take: parsed.data.pageSize,
  };

  const [rows, total] = await Promise.all([
    searchContractClauses(searchParams),
    countSearchContractClauses(searchParams),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      contractId: row.contractId,
      clauseNumber: row.clauseNumber,
      title: row.title,
      clauseType: row.reviewedClauseType ?? row.suggestedClauseType,
      snippet: buildSearchSnippet(row.text, parsed.data.q),
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / parsed.data.pageSize),
  };
}
