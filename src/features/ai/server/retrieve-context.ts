import type { Citation } from "@/domain/ai/citation";
import { buildChunkContext, buildContext, deduplicateByNormalizedText } from "@/domain/ai/context-builder";
import type { ConversationTurn } from "@/domain/ai/conversation-context";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { MIN_CITATION_SCORE_COMPREHENSIVE } from "@/domain/ai/hallucination-guard";
import { classifyQuestionComplexity } from "@/domain/ai/question-complexity";
import { COMPREHENSIVE_TOP_K, DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";
import { sampleHighValueClausesForComprehensiveReview } from "@/server/repositories/clause-family-sample-repository";

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
 *
 * §AI 답변 품질 개편 Phase 1.2 P0-3 - a THIRD, structurally-driven source
 * of clause citations, added ONLY for "comprehensive" questions ("내가
 * 불리한 게 뭐야?", "주의할 조항 있어?"): sampleHighValueClausesForComprehensiveReview()
 * (clause-family-sample-repository.ts) deterministically samples at most
 * one clause per high-value family (termination, payment, liability,
 * indemnity, ...) actually present in the target contract(s), regardless
 * of how well that clause's embedding happens to match the vague question
 * text. This is retrieval BROADENING, not a relevance judgment - every
 * family-sampled clause gets a FIXED FLOOR score of MIN_CITATION_SCORE_COMPREHENSIVE
 * (the comprehensive-mode guard threshold itself), never a fabricated
 * semantic score. When a high-value clause was NOT found by real semantic
 * search at all, this floor is applied as a brand-new citation. When it
 * WAS found (any score) but scored BELOW the floor, the EXISTING citation's
 * score is boosted up to the floor instead of adding a duplicate - a clause
 * already below the comprehensive guard threshold is not meaningfully
 * "already surfaced" from the guard's point of view, since it would be
 * silently dropped downstream exactly like any other weak match (measured
 * regression: with COMPREHENSIVE_TOP_K exceeding a contract's real clause
 * count, every clause gets SOME nonzero raw score, so an add-only-if-absent
 * dedup never gets a chance to run). A clause that already scored AT OR
 * ABOVE the floor via genuine relevance keeps its real (possibly much
 * higher) score untouched - a focused question never reaches this branch
 * at all.
 */
export async function retrieveContext(params: {
  organizationId: string;
  question: string;
  topK?: number;
  embeddingProvider?: EmbeddingProvider;
  /** §AI 상담 개편 - when set, restricts both retrieval legs to this one contract (still nested inside organizationId - never a substitute for it; the caller must have already verified the contract belongs to this organization). */
  contractId?: string;
  /** §AI 답변 품질 개편 P0-1 - bounded, already-authorized recent turns (see conversation-context.ts). Never trusted from the client - the caller must have loaded this via listMessagesForConversation()'s own org/user/contract scoping. */
  history?: readonly ConversationTurn[];
}): Promise<Citation[]> {
  const isComprehensive = classifyQuestionComplexity(params.question) === "comprehensive";
  const topK = params.topK ?? (isComprehensive ? COMPREHENSIVE_TOP_K : DEFAULT_TOP_K);
  const searchParams = { ...params, topK };

  const [clauseResults, chunkResults, familySamples] = await Promise.all([
    hybridSearchClauses(searchParams),
    hybridSearchDocumentChunks(searchParams),
    isComprehensive
      ? sampleHighValueClausesForComprehensiveReview({ organizationId: params.organizationId, contractId: params.contractId })
      : Promise.resolve([]),
  ]);

  const dedupedClauses = deduplicateByNormalizedText(clauseResults);
  const dedupedChunks = deduplicateByNormalizedText(chunkResults);

  const rawClauseCitations = dedupedClauses.map((result) => buildContext(result, params.question));
  const chunkCitations = dedupedChunks.map((result) => buildChunkContext(result, params.question));

  // §P0-3 fix - a high-value clause real semantic search ALREADY found (at
  // any score, even one that will be filtered out downstream by the
  // comprehensive-mode guard) is NOT "already surfaced" from the guard's
  // point of view once its score is below MIN_CITATION_SCORE_COMPREHENSIVE -
  // it would be silently dropped exactly like any other weak match, which
  // defeats the whole point of family sampling (measured regression: a
  // real 21-clause fixture where COMPREHENSIVE_TOP_K=30 exceeds the
  // clause count, so EVERY clause gets SOME raw score and the old
  // add-only-if-absent dedup never got a chance to run for any of them).
  // Boosting the EXISTING citation's score to the floor (never fabricating
  // a duplicate citation) guarantees every real, high-value-family clause
  // clears the comprehensive guard, while clauses that already scored
  // ABOVE the floor via genuine relevance keep their real (higher) score.
  const familySampleIdsById = new Map(familySamples.map((clause) => [clause.id, clause]));
  const clauseCitations = rawClauseCitations.map((citation) => {
    const isHighValueFamily = familySampleIdsById.has(citation.contractClauseId);
    if (isHighValueFamily && citation.score < MIN_CITATION_SCORE_COMPREHENSIVE) {
      return { ...citation, score: MIN_CITATION_SCORE_COMPREHENSIVE };
    }
    return citation;
  });

  const alreadyCitedClauseIds = new Set(clauseCitations.map((citation) => citation.contractClauseId));
  const familyCitations = familySamples
    .filter((clause) => !alreadyCitedClauseIds.has(clause.id))
    .map((clause) =>
      buildContext(
        {
          contractClauseId: clause.id,
          contractId: clause.contractId,
          contractTitle: clause.contractTitle,
          clauseNumber: clause.clauseNumber,
          title: clause.title,
          text: clause.text,
          score: MIN_CITATION_SCORE_COMPREHENSIVE,
        },
        params.question,
      ),
    );

  return [...clauseCitations, ...chunkCitations, ...familyCitations].sort((a, b) => b.score - a.score);
}
