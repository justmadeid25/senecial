import { createHash } from "node:crypto";

/**
 * Phase 12 - the embedding-staleness signal. Computed from the SAME
 * normalized text embeddings are actually generated from (never the raw
 * `text` column) - see normalize-clause-text.ts. A clause edit that
 * doesn't actually change the normalized text (e.g. only a title/orderIndex
 * change) produces the identical checksum, so no redundant EmbeddingJob is
 * ever enqueued (see EmbeddingJob's `@@unique([contractClauseId,
 * inputChecksum])`).
 */
export function computeClauseTextChecksum(normalizedText: string): string {
  return createHash("sha256").update(normalizedText).digest("hex");
}
