import { encode } from "gpt-tokenizer";

import { AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE } from "@/lib/config/ai-budget";

import type { Citation } from "./citation";
import { buildPromptMessages } from "./prompt-builder";
import { normalizeClauseText } from "../clauses/normalize-clause-text";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * §Phase 14.1 §5 - replaces the old fixed `CONTEXT_MAX_CLAUSES = 8` cap
 * (domain/ai/context-budget.ts, removed) with a REAL token-budget:
 * evidence is packed in by score until the actual, exactly-tokenized
 * prompt would exceed this window, never by a fixed evidence-item count.
 * A conservative-but-generous default: both currently configured LLM
 * providers (gpt-4.1-mini - openai-responses-llm-provider.ts; claude-sonnet-5
 * - get-llm-provider.ts) support well over this in their real context
 * window, so 128,000 leaves real headroom under either while still giving
 * comprehensive-review questions (§12) a genuinely high evidence ceiling -
 * "high safety ceiling allowed if documented/tested" (§5) - rather than
 * silently capping at whatever a smaller model's window happens to be.
 * Env-overridable per-deployment without a code change.
 */
export const AI_LLM_CONTEXT_WINDOW_TOKENS = parsePositiveInt(process.env.AI_LLM_CONTEXT_WINDOW_TOKENS, 128_000);

/**
 * §5 - a fixed buffer on top of the output-token reservation, absorbing
 * the real (small but nonzero) discrepancy between gpt-tokenizer's
 * cl100k_base count and whatever tokenizer the ACTUALLY-configured
 * provider uses internally (OpenAI's own count for gpt-4.1-mini won't be
 * byte-identical to cl100k_base's; Anthropic's is a different tokenizer
 * family entirely) - this is a genuine token count, not an estimate, but
 * it is a genuine count under OUR tokenizer, not necessarily theirs.
 */
export const CONTEXT_TOKEN_SAFETY_MARGIN = 500;

/**
 * §Phase 12.2 Part C pattern, extended - identifies which token-budget
 * SELECTION ALGORITHM (this file's packCitationsWithinTokenBudget, not
 * just the raw AI_LLM_CONTEXT_WINDOW_TOKENS value) is live. Included in
 * AiRuntimeConfiguration (replacing the old `contextMaxClauses` field) so
 * a future change to the packing algorithm itself is versioned the same
 * way a reranker or scoring-weight change already is.
 */
export const CONTEXT_BUDGET_VERSION = "token-budget-v1";

/** Real token count via the same tokenizer document-chunker.ts uses for chunk sizing - never a chars/4 approximation. */
export function countTokens(text: string): number {
  return encode(text).length;
}

function availableContextTokens(): number {
  return AI_LLM_CONTEXT_WINDOW_TOKENS - AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE - CONTEXT_TOKEN_SAFETY_MARGIN;
}

function totalPromptTokens(question: string, citations: readonly Citation[]): number {
  const messages = buildPromptMessages(question, citations);
  return messages.reduce((sum, message) => sum + countTokens(message.content), 0);
}

/**
 * §5 - de-duplicates ACROSS the two retrieval legs (a clause citation and
 * a chunk citation can legitimately cover near-identical text - see
 * retrieve-context.ts's own docstring on why per-leg dedup alone isn't
 * enough) by normalized evidence text, keeping the first (highest-scored,
 * since callers always pass an already score-sorted list) occurrence -
 * the same "keep first, drop rest" contract as
 * context-builder.ts's deduplicateByNormalizedText, just keyed on
 * `evidenceText` instead of `text` since Citation has no `text` field.
 */
function deduplicateCitationsByEvidenceText(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const deduped: Citation[] = [];
  for (const citation of citations) {
    const key = normalizeClauseText(citation.evidenceText);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(citation);
  }
  return deduped;
}

export interface ContextTokenBudgetResult {
  kept: Citation[];
  truncated: boolean;
  droppedCount: number;
  totalContextTokens: number;
}

/**
 * §Phase 14.1 §5 (Token-budget context construction) - replaces
 * truncateToContextBudget()'s fixed-count slice with a real budget: greedily
 * considers citations in score order (already sorted by retrieveContext.ts),
 * and keeps a citation only if the EXACT, fully-tokenized prompt
 * (buildPromptMessages(question, kept + [citation]) - the real system +
 * user message text, including every already-kept citation block and the
 * marker-instruction line, which itself grows with citation count) still
 * fits `AI_LLM_CONTEXT_WINDOW_TOKENS` minus the output reserve and safety
 * margin. A single oversized citation is SKIPPED (not a hard stop) so a
 * later, smaller, still-relevant citation can still be packed in - this is
 * why the loop doesn't just take the first N that fit in order; it
 * maximizes real evidence coverage under the token budget, not evidence
 * COUNT under an arbitrary ceiling.
 *
 * Deliberately recomputes the whole prompt's token count on every
 * candidate rather than summing pre-computed per-citation token deltas -
 * the marker-instruction line's own length depends on the full kept set,
 * so an incremental sum would silently drift from what the LLM actually
 * receives. `citations.length` here is at most a few dozen (two retrieval
 * legs' topK each, post-fusion) so the O(n^2) tokenization this implies is
 * negligible in practice.
 */
export function packCitationsWithinTokenBudget(
  question: string,
  citations: readonly Citation[],
  /** Test-only override for the available-context-token budget - production callers always omit this and get the real AI_LLM_CONTEXT_WINDOW_TOKENS-derived value, since that constant is fixed at module load from env and can't otherwise be exercised at a small scale in a unit test. */
  maxContextTokensOverride?: number
): ContextTokenBudgetResult {
  const deduped = deduplicateCitationsByEvidenceText(citations);
  const budget = maxContextTokensOverride ?? availableContextTokens();

  const kept: Citation[] = [];
  let currentTokens = totalPromptTokens(question, kept);

  for (const citation of deduped) {
    const candidateTokens = totalPromptTokens(question, [...kept, citation]);
    if (candidateTokens > budget) {
      continue;
    }
    kept.push(citation);
    currentTokens = candidateTokens;
  }

  return {
    kept,
    truncated: kept.length < deduped.length,
    droppedCount: deduped.length - kept.length,
    totalContextTokens: currentTokens,
  };
}
