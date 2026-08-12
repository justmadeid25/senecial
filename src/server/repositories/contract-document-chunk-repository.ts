import { Prisma } from "@/generated/prisma/client";
import { DOCUMENT_CHUNKER_VERSION, type DocumentChunk } from "@/domain/ai/document-chunker";
import { prisma } from "@/server/db/client";

export type ContractDocumentChunkRow = Prisma.ContractDocumentChunkGetPayload<Record<string, never>>;

/**
 * §Phase 14.1 §4 - replaces every chunk belonging to `extractedDocumentId`
 * with a fresh set, inside one transaction (a reader never observes a
 * moment with a partially-replaced chunk set). Called whenever raw
 * chunking (re)runs for a document - on first extraction success, and
 * again if a future chunker-version bump re-chunks an existing document.
 * Old chunks' embeddings/embedding-jobs cascade-delete with them (schema
 * `onDelete: Cascade`).
 */
export async function replaceDocumentChunks(params: {
  organizationId: string;
  contractId: string;
  extractedDocumentId: string;
  chunks: DocumentChunk[];
}): Promise<ContractDocumentChunkRow[]> {
  return prisma.$transaction(async (tx) => {
    await tx.contractDocumentChunk.deleteMany({ where: { extractedDocumentId: params.extractedDocumentId } });
    if (params.chunks.length === 0) {
      return [];
    }
    await tx.contractDocumentChunk.createMany({
      data: params.chunks.map((chunk) => ({
        organizationId: params.organizationId,
        contractId: params.contractId,
        extractedDocumentId: params.extractedDocumentId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        normalizedText: chunk.normalizedText,
        tokenCount: chunk.tokenCount,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        headingContext: chunk.headingContext,
        chunkerVersion: DOCUMENT_CHUNKER_VERSION,
      })),
    });
    return tx.contractDocumentChunk.findMany({
      where: { extractedDocumentId: params.extractedDocumentId },
      orderBy: { chunkIndex: "asc" },
    });
  });
}

export async function findChunksByContract(params: {
  organizationId: string;
  contractId: string;
}): Promise<ContractDocumentChunkRow[]> {
  return prisma.contractDocumentChunk.findMany({
    where: { organizationId: params.organizationId, contractId: params.contractId },
    orderBy: [{ extractedDocumentId: "asc" }, { chunkIndex: "asc" }],
  });
}

/** Org-scoped hydration by id - the same "an id alone is never enough" discipline as every other retrieval hydration query in this codebase (see hybrid-search-clauses.ts). */
export async function findChunksByIds(params: {
  organizationId: string;
  chunkIds: string[];
}): Promise<ContractDocumentChunkRow[]> {
  if (params.chunkIds.length === 0) return [];
  return prisma.contractDocumentChunk.findMany({
    where: { id: { in: params.chunkIds }, organizationId: params.organizationId },
  });
}

export async function countChunksForOrganization(organizationId: string): Promise<number> {
  return prisma.contractDocumentChunk.count({ where: { organizationId } });
}
