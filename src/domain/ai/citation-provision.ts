import type { Citation } from "./citation";

/**
 * §Citation Identity Canonicalization (Root-Cause Fix) - shared, deterministic
 * "same underlying provision" identity, extracted from answer-used-citations.ts
 * (where it was already proven in production as a POST-answer dedup step) so
 * retrieve-context.ts can apply the identical rule PRE-prompt too. A clause
 * leg citation ("제2조") and a chunk leg citation for the same article
 * ("제2조(해지)") are, from a reader's point of view, the same provision cited
 * twice - matched on the citation's own leading "제N조" token plus
 * contractId, NEVER on the full display string (which is exactly what let
 * the two legs' differing clauseReference spellings desync from each other -
 * see citation-marker.ts) and NEVER contractId alone (a different provision
 * within the same contract must never merge) or clauseReference alone across
 * DIFFERENT contracts (the same article number in two different contracts is
 * never the same provision).
 */
export function provisionKey(citation: Citation): string {
  const match = citation.clauseReference.match(/^제\s*\d+\s*조/);
  const article = match ? match[0].replace(/\s+/g, "") : citation.clauseReference;
  return `${citation.contractId}::${article}`;
}

/**
 * Collapses citations referring to the SAME provision (see provisionKey())
 * down to one, deterministically - never arbitrary/positional:
 *   1. a "clause" citation (the precise, structured evidence layer) is
 *      always preferred over a "chunk" citation (a raw-text span) for the
 *      same provision;
 *   2. when both sides are the same evidenceType, the higher-scored one wins.
 * `citations` need not be pre-sorted; the output is always sorted by score
 * descending, matching every other citation list in this codebase
 * (retrieveContext(), packCitationsWithinTokenBudget()).
 */
export function deduplicateBySameProvision(citations: readonly Citation[]): Citation[] {
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
