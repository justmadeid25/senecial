import { chunkDocumentText } from "@/domain/ai/document-chunker";
import { replaceDocumentChunks } from "@/server/repositories/contract-document-chunk-repository";

import { enqueueEmbeddingJobsForChunks } from "./enqueue-chunk-embedding-jobs";

export interface CreateDocumentChunksResult {
  chunkCount: number;
  embeddingJobsEnqueued: number;
}

/**
 * §Phase 14.1 §4/§11 - chunks a freshly (re)extracted document's full text
 * into raw retrievable evidence and enqueues embedding jobs for the
 * result, independent of clause segmentation entirely (this never reads
 * or waits on ContractClause/ClauseSegmentationJob) - so raw retrieval
 * exists even when segmentation is still pending, fails outright, or
 * misses content extraction itself captured. Deliberately called OUTSIDE
 * the extraction job's own transaction and swallows its own errors at the
 * call site (see process-extraction-job.ts) - same "never block the
 * feature this failure is downstream of" discipline as
 * enqueueEmbeddingJobsForClauses().
 */
export async function createDocumentChunksForExtractedDocument(params: {
  organizationId: string;
  contractId: string;
  extractedDocumentId: string;
  text: string;
}): Promise<CreateDocumentChunksResult> {
  const chunks = chunkDocumentText(params.text);

  const rows = await replaceDocumentChunks({
    organizationId: params.organizationId,
    contractId: params.contractId,
    extractedDocumentId: params.extractedDocumentId,
    chunks,
  });

  const { enqueued } = await enqueueEmbeddingJobsForChunks(
    rows.map((row) => ({ id: row.id, organizationId: row.organizationId, normalizedText: row.normalizedText }))
  );

  return { chunkCount: rows.length, embeddingJobsEnqueued: enqueued };
}
