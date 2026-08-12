import type { Citation } from "@/domain/ai/citation";
import { buildChunkContext, buildContext, deduplicateByNormalizedText } from "@/domain/ai/context-builder";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { classifyQuestionComplexity } from "@/domain/ai/question-complexity";
import { COMPREHENSIVE_TOP_K, DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";

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
 *
 * §Phase 14.1 §15 - a caller-supplied `topK` always wins (askQuestion()'s
 * real call sites never pass one, but the evaluation CLI/tests exercise
 * both retrieval legs directly at a fixed topK for IR-metric consistency,
 * not through this function). Otherwise `topK` is derived from a cheap,
 * synchronous keyword classification of the question
 * (question-complexity.ts) - "comprehensive" gets a much wider per-leg
 * topK, "focused" gets the existing default. No extra LLM call, no new
 * agent/router: the classifier is a pure function, and both legs still
 * run in exactly the same two concurrent calls as before.
 */
export async function retrieveContext(params: {
  organizationId: string;
  question: string;
  topK?: number;
  embeddingProvider?: EmbeddingProvider;
}): Promise<Citation[]> {
  const topK =
    params.topK ?? (classifyQuestionComplexity(params.question) === "comprehensive" ? COMPREHENSIVE_TOP_K : DEFAULT_TOP_K);
  const searchParams = { ...params, topK };

  const [clauseResults, chunkResults] = await Promise.all([
    hybridSearchClauses(searchParams),
    hybridSearchDocumentChunks(searchParams),
  ]);

  const dedupedClauses = deduplicateByNormalizedText(clauseResults);
  const dedupedChunks = deduplicateByNormalizedText(chunkResults);

  const clauseCitations = dedupedClauses.map((result) => buildContext(result, params.question));
  const chunkCitations = dedupedChunks.map((result) => buildChunkContext(result, params.question));

  return [...clauseCitations, ...chunkCitations].sort((a, b) => b.score - a.score);
}
