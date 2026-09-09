/**
 * §Citation Identity Canonicalization (Root-Cause Fix) - replaces the old
 * `[출처: {clauseReference} - {contractTitle}]` TEXT-matching marker with a
 * server-issued, closed-set NUMERIC token: the citation's own 1-based
 * position in the exact `citations` array supplied to buildUserPrompt() /
 * buildCitationBlock() for this request (see prompt-builder.ts). The model
 * never reconstructs display text as identity - it only ever copies a
 * number it was already shown next to the evidence (`[CITATION n]`), so a
 * legitimate reformatting of the SAME underlying provision across two
 * retrieval legs (clause leg "제2조" vs. chunk leg "제2조(해지)" - the
 * production UNKNOWN_CITATION_MARKER root cause) can no longer desync
 * identity from what the model is asked to copy back verbatim.
 *
 * The token is transient and per-request only - never persisted, never
 * treated as a stable identifier across requests. Resolving a validated
 * token back to a real Citation object (and its trusted display metadata)
 * is the caller's job (see citation-required.ts / answer-used-citations.ts),
 * always by array-index lookup against the SAME citations array the token
 * was assigned from - never by re-parsing or trusting any model-authored
 * text as identity or display.
 */
export function buildCitationMarker(index: number): string {
  return `[출처: ${index}]`;
}

/** One or more digits, optionally comma-separated within a single bracket (e.g. "[출처: 2, 5]") - a defensive allowance for a model that combines two provisions in one bracket instead of two side-by-side markers; each number still resolves/validates independently downstream. Never matches non-numeric content - a bracket containing anything else (stray text, a reconstructed clause reference) is simply not recognized as a marker at all, the same fail-closed "no marker found" outcome as an entirely absent one. */
const MARKER_PATTERN = /\[출처:\s*([\d,\s]+)\]/g;

export interface ParsedCitationMarker {
  /** 1-based position in the citations array this answer was generated against - never a database id, never derived from display text. */
  index: number;
}

function parseIndexList(raw: string): number[] {
  return raw
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => Number(piece))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Extracts every `[출처: n]` (or comma-combined `[출처: n, m]`) marker found in a piece of text - a single paragraph, or a whole answer. Purely syntactic: does not know or care whether a given index is actually valid for any particular citations array - that closed-set membership check is citation-required.ts's job. */
export function findCitationMarkers(text: string): ParsedCitationMarker[] {
  const markers: ParsedCitationMarker[] = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    for (const index of parseIndexList(match[1]!)) {
      markers.push({ index });
    }
  }
  return markers;
}
