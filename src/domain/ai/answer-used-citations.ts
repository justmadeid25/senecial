import type { Citation } from "./citation";
import { deduplicateBySameProvision } from "./citation-provision";
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
 *
 * §Citation Identity Canonicalization (Root-Cause Fix) - a marker is now a
 * closed-set 1-based INDEX into `contextCitations` (see citation-marker.ts),
 * never model-authored display text - so resolving "what did the answer
 * cite" back to a real Citation object is a plain array-index lookup, not a
 * text match. `contextCitations` passed here must be the exact same array
 * (same order) the answer was generated/validated against - see
 * citation-required.ts's assertAnswerBlockGrounded, which shares that same
 * invariant.
 */

/** Bump if the selection or dedup RULE itself changes shape (not a comment-only edit) - not currently wired into any cache key, since this always runs fresh against an already-final answer text, never against something that could itself go stale in a cache. */
export const ANSWER_USED_CITATION_VERSION = "v2";

/**
 * Returns the subset of `contextCitations` the FINAL grounded answer text
 * actually references via a `[출처: n]` marker (see citation-marker.ts),
 * deduplicated by underlying provision (see citation-provision.ts). Resolves
 * each marker's index directly against `contextCitations` - never against
 * clauseReference/contractTitle text - since a marker is now a closed-set
 * token the server itself issued, not text the LLM had to reconstruct.
 *
 * `answerText` must already be the GROUNDED (tag-stripped, validated) text
 * - the output of assertAnswerGrounded()/assertAnswerBlockGrounded(), never
 * the raw completion - so every marker found here is guaranteed to resolve
 * to a real supplied citation (an out-of-range index would already have
 * thrown before this function is ever called).
 */
export function filterCitationsToAnswerUsed(answerText: string, contextCitations: readonly Citation[]): Citation[] {
  const markers = findCitationMarkers(answerText);
  const usedIndexes = new Set(markers.map((m) => m.index).filter((index) => index >= 1 && index <= contextCitations.length));
  const used = [...usedIndexes].map((index) => contextCitations[index - 1]!);
  return deduplicateBySameProvision(used);
}
