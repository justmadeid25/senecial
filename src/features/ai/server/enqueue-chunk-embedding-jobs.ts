import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import { enqueueChunkEmbeddingJob } from "@/server/repositories/contract-document-chunk-embedding-job-repository";
import { findLatestEmbeddingForChunk } from "@/server/repositories/contract-document-chunk-embedding-repository";
import { prisma } from "@/server/db/client";

/**
 * §Phase 14.1 - mirrors enqueueEmbeddingJobsForClauses()
 * (enqueue-embedding-jobs.ts) exactly, for ContractDocumentChunk. Called
 * right after chunking (re)creates a document's chunks. Best-effort - a
 * failure here must never fail the extraction job that triggered chunking
 * (a chunk that exists but has no embedding yet is simply not retrievable
 * via raw-document search until the embedding worker/stale-scan catches
 * it up, same "never block on this" philosophy as the clause pipeline).
 * `computeClauseTextChecksum` is a pure SHA-256-of-text function with no
 * clause-specific logic despite its name - reused as-is rather than
 * duplicated.
 */
export async function enqueueEmbeddingJobsForChunks(
  chunks: { id: string; organizationId: string; normalizedText: string }[]
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  for (const chunk of chunks) {
    const checksum = computeClauseTextChecksum(chunk.normalizedText);
    const result = await enqueueChunkEmbeddingJob({
      organizationId: chunk.organizationId,
      chunkId: chunk.id,
      inputChecksum: checksum,
    });
    if (result) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export interface StaleChunkEmbeddingScanResult {
  scanned: number;
  enqueued: number;
}

/** Mirrors scanAndEnqueueStaleClauseEmbeddings() - idempotent, safe to run on a schedule as well as on demand. */
export async function scanAndEnqueueStaleChunkEmbeddings(organizationId?: string): Promise<StaleChunkEmbeddingScanResult> {
  const chunks = await prisma.contractDocumentChunk.findMany({
    where: organizationId ? { organizationId } : {},
    select: { id: true, organizationId: true, normalizedText: true },
  });

  let enqueued = 0;
  for (const chunk of chunks) {
    const currentChecksum = computeClauseTextChecksum(chunk.normalizedText);
    const latest = await findLatestEmbeddingForChunk(chunk.id);
    if (latest && latest.checksum === currentChecksum) {
      continue;
    }

    const result = await enqueueChunkEmbeddingJob({
      organizationId: chunk.organizationId,
      chunkId: chunk.id,
      inputChecksum: currentChecksum,
    });
    if (result) {
      enqueued += 1;
    }
  }

  return { scanned: chunks.length, enqueued };
}
