import type { Citation } from "./citation";
import { extractEvidenceSentence } from "./evidence-sentence";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";

export interface SearchResultLike {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  score: number;
}

const FALLBACK_CLAUSE_REFERENCE = "조항 번호 미상";

/** §Context Builder - one hybrid-search result -> one fully-populated Citation, never a partial one. */
export function buildContext(result: SearchResultLike, question: string): Citation {
  return {
    contractClauseId: result.contractClauseId,
    contractId: result.contractId,
    contractTitle: result.contractTitle,
    clauseReference: result.clauseNumber ?? result.title ?? FALLBACK_CLAUSE_REFERENCE,
    evidenceText: extractEvidenceSentence(result.text, question),
    score: result.score,
  };
}

/**
 * §Retrieval "Deduplicate" - collapses near-duplicate clauses (the exact
 * same boilerplate text repeated verbatim across several contracts - a
 * common real occurrence for standard clauses) down to the single
 * highest-scored occurrence, so the LLM is never handed the same
 * evidence sentence 3 times under 3 different contract names. Comparison
 * is on normalized text (whitespace/case-insensitive), not raw text.
 * `results` MUST already be sorted by score descending (hybridSearchClauses'
 * own contract) - the FIRST occurrence of each normalized text is kept.
 */
export function deduplicateByNormalizedText<T extends { text: string }>(results: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const result of results) {
    const key = normalizeClauseText(result.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}
