import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ExtractedDocumentRow = Prisma.ContractExtractedDocumentGetPayload<
  Record<string, never>
>;

export interface CreateExtractedDocumentData {
  extractionJobId: string;
  organizationId: string;
  contractId: string;
  contractFileId: string;
  text: string;
  characterCount: number;
  pageCount?: number | null;
  language?: string | null;
  extractionMethod: string;
  contentChecksum: string;
}

export async function createExtractedDocument(
  data: CreateExtractedDocumentData,
  client: DbClient = prisma
): Promise<ExtractedDocumentRow> {
  return client.contractExtractedDocument.create({ data });
}

export async function findExtractedDocumentByJobId(
  params: { organizationId: string; extractionJobId: string },
  client: DbClient = prisma
): Promise<ExtractedDocumentRow | null> {
  return client.contractExtractedDocument.findFirst({
    where: { extractionJobId: params.extractionJobId, organizationId: params.organizationId },
  });
}

/** Used by Phase 7's clause segmentation job creation, which references an extracted document directly by id rather than by its extraction job. */
export async function findExtractedDocumentById(
  params: { organizationId: string; contractId: string; extractedDocumentId: string },
  client: DbClient = prisma
): Promise<ExtractedDocumentRow | null> {
  return client.contractExtractedDocument.findFirst({
    where: {
      id: params.extractedDocumentId,
      organizationId: params.organizationId,
      contractId: params.contractId,
    },
  });
}

export async function listExtractedDocumentsByContract(
  params: { organizationId: string; contractId: string },
  client: DbClient = prisma
): Promise<ExtractedDocumentRow[]> {
  return client.contractExtractedDocument.findMany({
    where: { organizationId: params.organizationId, contractId: params.contractId },
    orderBy: { createdAt: "desc" },
  });
}
