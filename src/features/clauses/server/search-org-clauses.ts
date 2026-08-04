import { buildSearchSnippet, type SearchSnippet } from "@/domain/clauses/search-snippet";
import { ValidationError } from "@/lib/errors";
import { clauseSearchQuerySchema } from "@/lib/validation/clauses";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findReadyClauseSegmentationJobsByOrganization } from "@/server/repositories/clause-segmentation-job-repository";
import {
  countSearchContractClauses,
  searchContractClauses,
} from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

export interface OrgClauseSearchResultItem {
  id: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  clauseType: string | null;
  updatedAt: Date;
  snippet: SearchSnippet | null;
}

export interface SearchOrgClausesParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

export interface SearchOrgClausesResult {
  items: OrgClauseSearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Same "latest job per document, org-wide" scoping as searchContractClausesInContract - see that file's comment. */
async function latestReadyJobIdsForOrganization(organizationId: string): Promise<string[]> {
  const jobs = await findReadyClauseSegmentationJobsByOrganization(organizationId);
  const latestByDocument = new Map<string, string>();
  for (const job of jobs) {
    if (!latestByDocument.has(job.extractedDocumentId)) {
      latestByDocument.set(job.extractedDocumentId, job.id);
    }
  }
  return [...latestByDocument.values()];
}

/** organizationId is always enforced at the search-query level - a different organization's clauses are never returned, regardless of contract/segmentation job ids. */
export async function searchOrgClauses(params: SearchOrgClausesParams): Promise<SearchOrgClausesResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = clauseSearchQuerySchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "검색어를 입력해 주세요.");
  }

  const latestJobIds = await latestReadyJobIdsForOrganization(authContext.organizationId);
  if (latestJobIds.length === 0) {
    return { items: [], total: 0, page: parsed.data.page, pageSize: parsed.data.pageSize, totalPages: 0 };
  }

  const searchParams = {
    organizationId: authContext.organizationId,
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

  const contractIds = [...new Set(rows.map((row) => row.contractId))];
  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: { id: true, title: true },
  });
  const titleByContractId = new Map(contracts.map((contract) => [contract.id, contract.title]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      contractId: row.contractId,
      contractTitle: titleByContractId.get(row.contractId) ?? "(삭제된 계약)",
      clauseNumber: row.clauseNumber,
      title: row.title,
      clauseType: row.reviewedClauseType ?? row.suggestedClauseType,
      updatedAt: row.updatedAt,
      snippet: buildSearchSnippet(row.text, parsed.data.q),
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / parsed.data.pageSize),
  };
}
