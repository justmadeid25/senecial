import { hashCacheInput } from "./cache-key";
import type { LlmMessage } from "./llm-provider";

/**
 * §AI 답변 품질 개편 P0-1 - bounded multi-turn conversation context. Before
 * this module, `conversationId` was persisted and threaded through every
 * call but never actually READ BACK anywhere - retrieval and the LLM
 * prompt only ever saw the current question in isolation, so a follow-up
 * like "그럼 언제까지 말해야 돼?" had zero information about what "그럼"
 * referred to. This module is the pure, deterministic layer that turns a
 * caller-loaded (already org/user/contract-scoped - see
 * ai-conversation-repository.ts's listMessagesForConversation()) message
 * history into (a) a bounded set of turns safe to hand to the LLM and (b)
 * a bounded, deterministic text fragment that strengthens the RETRIEVAL
 * query - never an unbounded transcript dump into either.
 */

export interface ConversationTurn {
  role: "USER" | "ASSISTANT";
  content: string;
}

/** How many most-recent user+assistant PAIRS are included in the LLM prompt as conversation history. Bounded so prompt size/cost cannot grow unboundedly with a long-running conversation. */
export const MAX_CONTEXT_TURNS = 3;

/**
 * How many most-recent turns fold into the RETRIEVAL query text (both the
 * keyword and embedding legs - see hybrid-search-clauses.ts). Deliberately
 * narrower than MAX_CONTEXT_TURNS: retrieval needs just enough of the
 * immediately preceding exchange to resolve a contextless follow-up
 * ("그럼 언제까지 말해야 돼?" needs to know the PRECEDING turn was about
 * 자동갱신/통지, not the entire conversation) - folding in older turns
 * would risk diluting the search with concepts from a topic the
 * conversation has already moved past.
 */
export const MAX_RETRIEVAL_HISTORY_TURNS = 1;

/** Hard per-message truncation bound (characters) applied everywhere history content is used - retrieval query augmentation AND the LLM prompt alike - so one unusually long prior answer can never single-handedly blow up either. */
export const MAX_HISTORY_MESSAGE_CHARS = 400;

function truncate(content: string): string {
  return content.length > MAX_HISTORY_MESSAGE_CHARS ? `${content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}...` : content;
}

/**
 * Bounds a full (already-authorized) message list down to the most recent
 * `maxTurns` PAIRS worth of messages (2 * maxTurns messages), oldest of
 * that window first, each truncated. `messages` MUST already be sorted
 * oldest-first (listMessagesForConversation()'s own contract) - this
 * function only ever looks at the trailing slice, it does not re-sort.
 * Deliberately tolerant of an odd/non-alternating tail (e.g. a USER
 * message with no following ASSISTANT reply, when a prior turn's citation
 * validation failed and no assistant message was ever persisted - see
 * ask-question.ts) - it is still safe and meaningful to include whatever
 * trailing messages actually exist, bounded by count.
 */
export function selectRecentConversationHistory(
  messages: readonly { role: "USER" | "ASSISTANT"; content: string }[],
  maxTurns: number = MAX_CONTEXT_TURNS
): ConversationTurn[] {
  if (maxTurns <= 0 || messages.length === 0) return [];
  const windowSize = maxTurns * 2;
  const recent = messages.slice(Math.max(0, messages.length - windowSize));
  return recent.map((message) => ({ role: message.role, content: truncate(message.content) }));
}

/**
 * Builds the text actually handed to keyword extraction + the embedding
 * provider for THIS request - the current question plus, when available,
 * the single most recent turn's content (both roles, truncated). This is
 * what lets a contextless follow-up retrieve the right clause: folding in
 * the prior turn's real content (which already contains the actual
 * concepts - "자동갱신"/"통지"/"30일" - as literal text) gives both the
 * keyword-stem leg and the embedding leg something concrete to match
 * against, without a second paid LLM call to "rewrite" the query.
 *
 * Deliberately NOT used for the exact-phrase-bonus heuristic or for
 * evidence-sentence extraction/citation display - those must continue to
 * reflect only what the user actually typed THIS turn (see
 * hybrid-search-clauses.ts).
 */
export function buildHistoryAugmentedSearchQuery(question: string, history: readonly ConversationTurn[]): string {
  if (history.length === 0) return question;
  const recentTurns = history.slice(Math.max(0, history.length - MAX_RETRIEVAL_HISTORY_TURNS * 2));
  const historyText = recentTurns.map((turn) => truncate(turn.content)).join(" ");
  return `${question} ${historyText}`.trim();
}

/**
 * A short, deterministic fingerprint of the bounded history actually used
 * for THIS request - folded into the retrieval cache key (see
 * retrieval-cache-key.ts) so two conversations with different histories
 * but an identical final question can never share a cached retrieval
 * result (and, symmetrically, an identical history + question pair - even
 * across different conversationIds - correctly DOES share a cache hit,
 * since nothing about identity beyond content matters here).
 */
export function buildHistoryFingerprint(history: readonly ConversationTurn[]): string {
  if (history.length === 0) return "";
  const relevant = history.slice(Math.max(0, history.length - MAX_RETRIEVAL_HISTORY_TURNS * 2));
  return hashCacheInput(relevant.map((turn) => `${turn.role}:${turn.content}`).join("\n"));
}

/** Maps bounded ConversationTurn[] into the LlmMessage[] shape prompt-builder.ts inserts before the current turn's user message - USER -> "user", ASSISTANT -> "assistant" (never "system" - history can never masquerade as a system-level instruction). */
export function toLlmHistoryMessages(history: readonly ConversationTurn[]): LlmMessage[] {
  return history.map((turn) => ({ role: turn.role === "USER" ? "user" : "assistant", content: turn.content }));
}
