import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { ClauseClassificationState, ClauseType } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ContractClauseRow = Prisma.ContractClauseGetPayload<Record<string, never>>;

export interface CreateContractClauseData {
  id: string;
  organizationId: string;
  contractId: string;
  extractedDocumentId: string;
  segmentationJobId: string;
  sectionId?: string | null;
  parentClauseId?: string | null;
  clauseNumber?: string | null;
  title?: string | null;
  text: string;
  normalizedText: string;
  orderIndex: number;
  depth: number;
  startOffset: number;
  endOffset: number;
  suggestedClauseType?: ClauseType | null;
  classificationConfidence?: Prisma.Decimal | null;
  classificationSignals?: Prisma.InputJsonValue;
}

export async function createContractClauses(
  rows: CreateContractClauseData[],
  client: DbClient = prisma
): Promise<{ count: number }> {
  if (rows.length === 0) {
    return { count: 0 };
  }
  return client.contractClause.createMany({ data: rows });
}

export async function findClausesBySegmentationJobId(
  params: { organizationId: string; segmentationJobId: string; skip?: number; take?: number },
  client: DbClient = prisma
): Promise<ContractClauseRow[]> {
  return client.contractClause.findMany({
    where: { organizationId: params.organizationId, segmentationJobId: params.segmentationJobId },
    orderBy: { orderIndex: "asc" },
    skip: params.skip,
    take: params.take,
  });
}

/** Used to gather all clauses across a contract's "latest job per document" set - see generate-clause-review-signals.ts. */
export async function findClausesBySegmentationJobIds(
  params: { organizationId: string; segmentationJobIds: string[] },
  client: DbClient = prisma
): Promise<ContractClauseRow[]> {
  if (params.segmentationJobIds.length === 0) {
    return [];
  }
  return client.contractClause.findMany({
    where: {
      organizationId: params.organizationId,
      segmentationJobId: { in: params.segmentationJobIds },
    },
    orderBy: [{ contractId: "asc" }, { orderIndex: "asc" }],
  });
}

export async function countClausesBySegmentationJobId(
  params: { organizationId: string; segmentationJobId: string },
  client: DbClient = prisma
): Promise<number> {
  return client.contractClause.count({
    where: { organizationId: params.organizationId, segmentationJobId: params.segmentationJobId },
  });
}

export async function findClauseById(
  params: { organizationId: string; contractId: string; clauseId: string },
  client: DbClient = prisma
): Promise<ContractClauseRow | null> {
  return client.contractClause.findFirst({
    where: {
      id: params.clauseId,
      contractId: params.contractId,
      organizationId: params.organizationId,
    },
  });
}

export interface UpdateClauseReviewData {
  classificationState: ClauseClassificationState;
  reviewedClauseType: ClauseType | null;
  reviewedById: string;
  reviewedAt: Date;
}

/** Org-scoped updateMany-then-refetch, matching Phase 6's updateSuggestionReview() pattern. */
export async function updateClauseReview(
  params: { organizationId: string; clauseId: string; data: UpdateClauseReviewData },
  client: DbClient = prisma
): Promise<ContractClauseRow | null> {
  const result = await client.contractClause.updateMany({
    where: { id: params.clauseId, organizationId: params.organizationId },
    data: params.data,
  });
  if (result.count === 0) {
    return null;
  }
  return client.contractClause.findUnique({ where: { id: params.clauseId } });
}

export interface SearchClausesParams {
  organizationId: string;
  contractId?: string;
  query: string;
  clauseType?: ClauseType;
  latestJobIdsByContract?: string[];
  skip?: number;
  take?: number;
}

/**
 * ILIKE-based search (Prisma `contains` + mode:"insensitive") over
 * normalizedText/text/clauseNumber - identical query pattern to the
 * existing contract search service. A pg_trgm GIN index on normalizedText
 * (see the Phase 7 migration) makes this fast at scale, but the query
 * itself is correct with or without that index.
 */
// Two separate OR-groups (clauseType match, query match) can't live as two
// `OR` keys on the same object literal - the second would silently
// overwrite the first. Each group is pushed as its own AND-ed where
// fragment instead, matching postgres-contract-search-service.ts's
// andConditions pattern.
function buildClauseSearchWhere(params: SearchClausesParams): Prisma.ContractClauseWhereInput {
  const andConditions: Prisma.ContractClauseWhereInput[] = [
    { organizationId: params.organizationId },
    // A soft-deleted contract's clauses are never search results, matching
    // every other list/search view in this codebase.
    { contract: { deletedAt: null } },
  ];
  if (params.contractId) {
    andConditions.push({ contractId: params.contractId });
  }
  if (params.latestJobIdsByContract) {
    andConditions.push({ segmentationJobId: { in: params.latestJobIdsByContract } });
  }
  if (params.clauseType) {
    andConditions.push({
      OR: [{ suggestedClauseType: params.clauseType }, { reviewedClauseType: params.clauseType }],
    });
  }
  andConditions.push({
    OR: [
      { normalizedText: { contains: params.query.toLowerCase(), mode: "insensitive" } },
      { title: { contains: params.query, mode: "insensitive" } },
      { clauseNumber: { contains: params.query, mode: "insensitive" } },
    ],
  });
  return { AND: andConditions };
}

export async function searchContractClauses(
  params: SearchClausesParams,
  client: DbClient = prisma
): Promise<ContractClauseRow[]> {
  return client.contractClause.findMany({
    where: buildClauseSearchWhere(params),
    orderBy: [{ contractId: "asc" }, { orderIndex: "asc" }],
    skip: params.skip,
    take: params.take,
  });
}

export async function countSearchContractClauses(
  params: SearchClausesParams,
  client: DbClient = prisma
): Promise<number> {
  return client.contractClause.count({ where: buildClauseSearchWhere(params) });
}
