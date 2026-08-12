import type { Citation } from "@/domain/ai/citation";
import { buildChunkContext, buildContext, deduplicateByNormalizedText } from "@/domain/ai/context-builder";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";

import { hybridSearchClauses } from "./hybrid-search-clauses";
import { hybridSearchDocumentChunks } from "./hybrid-search-document-chunks";

/**
 * §Phase 14.1 §3/§4 - Dual retrieval: the structured ContractClause leg
 * (hybridSearchClauses, pre-existing) and the new raw-document
 * ContractDocumentChunk leg (hybridSearchDocumentChunks) run CONCURRENTLY
 * against the exact same (organizationId, question) - two fully
 * independent, equally org-scoped pipelines, not one leg gating the
 * other. This is what makes §11's "clause extraction failure != AI
 * knowledge failure" true structurally: a fact missing from
 * ContractClause (extraction/segmentation gap) is still reachable via the
 * chunk leg, which is built straight from ContractExtractedDocument.text
 * independent of clause segmentation ever succeeding (see
 * document-chunker.ts / create-document-chunks-for-extracted-document.ts).
 *
 * Deduplication is applied PER LEG (clause text vs. chunk text each have
 * their own near-duplicate shape - a clause and its raw-text superset
 * chunk are NOT the same "duplicate" the way two copies of the same
 * boilerplate clause are), then the two citation lists are concatenated
 * and sorted by score - never merged/deduped across legs, since a clause
 * citation and a chunk citation covering the same passage are
 * deliberately kept as two independent pieces of evidence (different
 * evidenceType, different provenance) rather than collapsed into one.
 *
 * §Retrieval - 질문 -> Embedding -> Hybrid Search -> Top K -> Deduplicate
 * -> Context Builder. Deliberately returns an EMPTY array rather than
 * throwing when nothing relevant is found - "no evidence" is a valid,
 * expected outcome the hallucination guard (see
 * domain/ai/hallucination-guard.ts) must be able to detect and respond
 * "모른다" to, not an error condition.
 */
export async function retrieveContext(params: {
  organizationId: string;
  question: string;
  topK?: number;
  embeddingProvider?: EmbeddingProvider;
}): Promise<Citation[]> {
  const [clauseResults, chunkResults] = await Promise.all([
    hybridSearchClauses(params),
    hybridSearchDocumentChunks(params),
  ]);

  const dedupedClauses = deduplicateByNormalizedText(clauseResults);
  const dedupedChunks = deduplicateByNormalizedText(chunkResults);

  const clauseCitations = dedupedClauses.map((result) => buildContext(result, params.question));
  const chunkCitations = dedupedChunks.map((result) => buildChunkContext(result, params.question));

  return [...clauseCitations, ...chunkCitations].sort((a, b) => b.score - a.score);
}
