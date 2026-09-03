import type { Citation } from "./citation";
import { findCitationMarkers } from "./citation-marker";

/**
 * §AI 답변 품질 개편 Phase 1.4 - "answer-used" vs "retrieved/context"
 * citations are two DIFFERENT sets, and this module is the single place
 * that computes the former from the latter. `contextCitations` (the full
 * set packed into the prompt - see context-token-budget.ts) is deliberately
 * broad, so the LLM has enough material to answer well; the FINAL answer
 * text only ever discusses a subset of it. Before this module existed,
 * `askQuestion()`/`askQuestionStreaming()` returned `contextCitations`
 * itself as `result.citations` - correct as "what the model could see",
 * wrong as "what the model actually said" (Phase 1.3's real-OpenAI eval
 * measured this directly: a q6 answer that only discusses Article 6's
 * delayed-interest clause still rendered citations for confidentiality/
 * termination/delay-penalty/force-majeure, none of which the answer text
 * ever mentions).
 *
 * Citation markers are already validated (never hallucinated - see
 * citation-required.ts's assertAnswerBlockGrounded, called BEFORE this
 * module ever runs) by the time filterCitationsToAnswerUsed() is called -
 * this module's job is purely to SELECT the subset of already-valid
 * `contextCitations` the grounded answer text actually references, not to
 * re-validate anything.
 */

/** Bump if the selection or dedup RULE itself changes shape (not a comment-only edit) - not currently wired into any cache key, since this always runs fresh against an already-final answer text, never against something that could itself go stale in a cache. */
export const ANSWER_USED_CITATION_VERSION = "v1";

/**
 * A clause citation ("제7조") and a chunk citation covering the same
 * article ("제7조(납품 및 검수)") are, from a READER's point of view, the
 * same underlying provision cited twice - see retrieve-context.ts's own
 * docstring on why the two legs are deliberately NOT deduplicated against
 * each other at retrieval time (a real defense against clause-extraction
 * failures). That defense is only useful while both are still IN the
 * candidate pool the LLM can draw from; once the answer has settled on one
 * (or both happened to get referenced), showing the reader two citation
 * chips for what reads as one article is just clutter. Matches on the
 * clauseReference's leading "제N조" token plus contractId - never contractId
 * alone (a different provision within the same contract must never merge)
 * and never clauseReference alone across DIFFERENT contracts (see the
 * comprehensive-review family-sampling path, which can plausibly surface
 * evidence from more than one contract in an org-wide question).
 */
function provisionKey(citation: Citation): string {
  const match = citation.clauseReference.match(/^제\s*\d+\s*조/);
  const article = match ? match[0].replace(/\s+/g, "") : citation.clauseReference;
  return `${citation.contractId}::${article}`;
}

/**
 * Collapses citations referring to the SAME provision (see provisionKey())
 * down to one, preferring a "clause" citation (the precise, structured
 * evidence layer) over a "chunk" citation (a raw-text span) for the same
 * provision, and the higher-scored one when both are the same type - never
 * arbitrary/positional. `citations` need not be pre-sorted; the output is
 * always sorted by score descending, matching every other citation list in
 * this codebase (retrieveContext(), packCitationsWithinTokenBudget()).
 */
function deduplicateBySameProvision(citations: readonly Citation[]): Citation[] {
  const byProvision = new Map<string, Citation>();
  for (const citation of citations) {
    const key = provisionKey(citation);
    const existing = byProvision.get(key);
    if (!existing) {
      byProvision.set(key, citation);
      continue;
    }
    const citationIsBetter =
      (citation.evidenceType === "clause" && existing.evidenceType !== "clause") ||
      (citation.evidenceType === existing.evidenceType && citation.score > existing.score);
    if (citationIsBetter) {
      byProvision.set(key, citation);
    }
  }
  return [...byProvision.values()].sort((a, b) => b.score - a.score);
}

/**
 * Returns the subset of `contextCitations` the FINAL grounded answer text
 * actually references via a `[출처: 조항 - 계약명]` marker (see
 * citation-marker.ts), deduplicated by underlying provision. Matches on
 * the same (clauseReference, contractTitle) pair citation-required.ts
 * itself validates against - never contractClauseId/chunkId, since a
 * marker is text the LLM wrote, not a database id it never sees.
 *
 * `answerText` must already be the GROUNDED (tag-stripped, validated) text
 * - the output of assertAnswerGrounded()/assertAnswerBlockGrounded(), never
 * the raw completion - so every marker found here is guaranteed to resolve
 * to a real supplied citation (a hallucinated marker would already have
 * thrown before this function is ever called).
 */
export function filterCitationsToAnswerUsed(answerText: string, contextCitations: readonly Citation[]): Citation[] {
  const markers = findCitationMarkers(answerText);
  const usedKeys = new Set(markers.map((m) => `${m.clauseReference}::${m.contractTitle}`));
  const used = contextCitations.filter((c) => usedKeys.has(`${c.clauseReference}::${c.contractTitle}`));
  return deduplicateBySameProvision(used);
}
