import type { Citation } from "./citation";

/**
 * Phase 12 Part E/F - the one shared marker format every piece of the AI
 * pipeline agrees on: prompt-builder.ts embeds each citation as a
 * parseable block using this same clauseReference/contractTitle pair,
 * the Development LLM provider echoes it back as a `[출처: ...]` marker
 * per paragraph, and citation-required.ts checks for that exact marker
 * shape. A real (non-development) LLM provider is instructed via the
 * system prompt (see prompt-builder.ts) to emit the same marker format,
 * so citation-required.ts's enforcement is provider-agnostic.
 */
export function buildCitationMarker(citation: Pick<Citation, "clauseReference" | "contractTitle">): string {
  return `[출처: ${citation.clauseReference} - ${citation.contractTitle}]`;
}

const MARKER_PATTERN = /\[출처:\s*([^\]-]+?)\s*-\s*([^\]]+?)\]/g;

export interface ParsedCitationMarker {
  clauseReference: string;
  contractTitle: string;
}

/**
 * §AI 답변 품질 개편 Phase 1.4 (real-OpenAI rerun regression) - a real
 * model, asked (via prompt-builder.ts's relevance-discipline rule) to
 * explain how one provision qualifies/relates to another IN THE SAME
 * paragraph, sometimes cites both provisions in ONE bracket
 * ("[출처: 제4조, 제5조 - 계약명]") instead of two separate ones
 * ("[출처: 제4조 - 계약명] [출처: 제5조 - 계약명]") - both are legitimate
 * ways to express "this paragraph rests on two real, supplied citations",
 * but MARKER_PATTERN's own capture group treats the former as ONE opaque
 * clauseReference string ("제4조, 제5조") that matches neither citation
 * individually, so citation-required.ts's assertAnswerBlockGrounded()
 * rejected an otherwise fully-grounded answer as if it were a fabrication.
 *
 * splitCombinedReference() is the fix: ONLY when a comma-separated
 * clauseReference has TWO OR MORE pieces that EACH independently look like
 * their own "제N조..." article reference does it get split into separate
 * markers - each still validated independently downstream (a fabricated
 * "제99조" mixed into "제4조, 제99조" still fails, since that specific
 * piece won't match any real citation). Deliberately narrow: a
 * clauseReference that merely CONTAINS a comma without every piece
 * matching this shape (e.g. a hypothetical clause title with a literal
 * comma in it) is left completely untouched, single-piece, exactly as
 * before - this is additive precision, never a general loosening of what
 * counts as a valid marker.
 */
const ARTICLE_REFERENCE_SHAPE = /^제\s*\d+\s*조/;

function splitCombinedReference(rawReference: string): string[] {
  if (!rawReference.includes(",")) {
    return [rawReference];
  }
  const pieces = rawReference
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  const everyPieceIsAnArticleReference = pieces.length > 1 && pieces.every((piece) => ARTICLE_REFERENCE_SHAPE.test(piece));
  return everyPieceIsAnArticleReference ? pieces : [rawReference];
}

/**
 * Extracts every `[출처: ... - ...]` marker found in a piece of text (a
 * single paragraph, or a whole answer) - a bracket whose clauseReference
 * combines multiple real "제N조" references (see splitCombinedReference()
 * above) expands into one ParsedCitationMarker PER referenced provision,
 * so a caller validating/filtering by (clauseReference, contractTitle)
 * never has to special-case a combined bracket itself.
 */
export function findCitationMarkers(text: string): ParsedCitationMarker[] {
  const markers: ParsedCitationMarker[] = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const contractTitle = match[2]!.trim();
    for (const clauseReference of splitCombinedReference(match[1]!.trim())) {
      markers.push({ clauseReference, contractTitle });
    }
  }
  return markers;
}
