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

/** Extracts every `[출처: ... - ...]` marker found in a piece of text (a single paragraph, or a whole answer). */
export function findCitationMarkers(text: string): ParsedCitationMarker[] {
  const markers: ParsedCitationMarker[] = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    markers.push({ clauseReference: match[1]!.trim(), contractTitle: match[2]!.trim() });
  }
  return markers;
}
