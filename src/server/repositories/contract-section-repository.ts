import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ContractSectionRow = Prisma.ContractSectionGetPayload<Record<string, never>>;

export interface CreateContractSectionData {
  id: string;
  organizationId: string;
  contractId: string;
  extractedDocumentId: string;
  segmentationJobId: string;
  title?: string | null;
  sectionType?: string | null;
  orderIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export async function createContractSections(
  rows: CreateContractSectionData[],
  client: DbClient = prisma
): Promise<{ count: number }> {
  if (rows.length === 0) {
    return { count: 0 };
  }
  return client.contractSection.createMany({ data: rows });
}

export async function findSectionsBySegmentationJobId(
  params: { organizationId: string; segmentationJobId: string },
  client: DbClient = prisma
): Promise<ContractSectionRow[]> {
  return client.contractSection.findMany({
    where: { organizationId: params.organizationId, segmentationJobId: params.segmentationJobId },
    orderBy: { orderIndex: "asc" },
  });
}
