import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { SuggestionReviewStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type FieldSuggestionRow = Prisma.ContractFieldSuggestionGetPayload<
  Record<string, never>
>;

export interface CreateFieldSuggestionData {
  extractionJobId: string;
  organizationId: string;
  contractId: string;
  fieldKey: string;
  rawValue?: string | null;
  normalizedValue?: Prisma.InputJsonValue;
  confidence?: Prisma.Decimal | null;
  sourceText?: string | null;
  sourcePage?: number | null;
}

export async function createFieldSuggestions(
  rows: CreateFieldSuggestionData[],
  client: DbClient = prisma
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await client.contractFieldSuggestion.createMany({ data: rows });
}

export async function findSuggestionsByJobId(
  params: { organizationId: string; extractionJobId: string },
  client: DbClient = prisma
): Promise<FieldSuggestionRow[]> {
  return client.contractFieldSuggestion.findMany({
    where: { extractionJobId: params.extractionJobId, organizationId: params.organizationId },
    orderBy: { fieldKey: "asc" },
  });
}

export async function findSuggestionById(
  params: { organizationId: string; extractionJobId: string; suggestionId: string },
  client: DbClient = prisma
): Promise<FieldSuggestionRow | null> {
  return client.contractFieldSuggestion.findFirst({
    where: {
      id: params.suggestionId,
      extractionJobId: params.extractionJobId,
      organizationId: params.organizationId,
    },
  });
}

/** Re-extraction (REVIEW_REQUIRED -> PROCESSING) clears prior suggestions before new ones are generated - simplest correct revision policy for this Phase's scope (no suggestion history is kept). */
export async function deleteSuggestionsByJobId(
  extractionJobId: string,
  client: DbClient = prisma
): Promise<void> {
  await client.contractFieldSuggestion.deleteMany({ where: { extractionJobId } });
}

export interface ReviewSuggestionData {
  reviewStatus: SuggestionReviewStatus;
  reviewedValue?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  reviewedById: string;
  reviewedAt: Date;
}

export async function updateSuggestionReview(
  params: { organizationId: string; suggestionId: string; data: ReviewSuggestionData },
  client: DbClient = prisma
): Promise<FieldSuggestionRow | null> {
  const result = await client.contractFieldSuggestion.updateMany({
    where: { id: params.suggestionId, organizationId: params.organizationId },
    data: params.data,
  });
  if (result.count === 0) {
    return null;
  }
  return client.contractFieldSuggestion.findFirst({ where: { id: params.suggestionId } });
}
