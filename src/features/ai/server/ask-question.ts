import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { hashCacheInput } from "@/domain/ai/cache-key";
import type { Citation } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation } from "@/domain/ai/citation-required";
import { checkEvidenceSufficiency, UNKNOWN_ANSWER_TEXT } from "@/domain/ai/hallucination-guard";
import type { LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { buildPromptMessages } from "@/domain/ai/prompt-builder";
import { getCacheProvider } from "@/server/services/ai/cache/get-cache-provider";
import { recordCacheEvent, recordDependencyLatency, recordLlmUsage } from "@/server/monitoring/metrics";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";

import { recordAiSearchPatterns } from "./record-ai-search-pattern";
import { retrieveContext } from "./retrieve-context";

export interface AskQuestionResult {
  answerText: string;
  citations: Citation[];
  sufficient: boolean;
}

/**
 * §Cache (Phase 12 Part N) - prompt/LLM cache key. The full prompt
 * (system + user messages, which already embed every citation's evidence
 * text and the question) is the cache's own natural invalidation
 * boundary: any change to the question OR the retrieved citations
 * produces a different key automatically, with no separate checksum
 * needed (unlike the retrieval cache, whose key does NOT already encode
 * the embedding set's state).
 */
function buildPromptCacheKey(llm: LlmProvider, messages: readonly LlmMessage[]): string {
  const serialized = messages.map((message) => `${message.role}:${message.content}`).join("\n---\n");
  return `prompt:${llm.providerName}:${llm.modelName}:${hashCacheInput(serialized)}`;
}

/**
 * Non-streaming entry point - used by the evaluation CLI (Part J, which
 * needs one final string per golden-dataset question, not a live stream)
 * and by anywhere else that just wants a complete answer.
 */
export async function askQuestion(params: { organizationId: string; question: string }): Promise<AskQuestionResult> {
  const citations = await retrieveContext({ organizationId: params.organizationId, question: params.question });
  const guard = checkEvidenceSufficiency(citations);

  if (!guard.sufficient) {
    await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
    return { answerText: UNKNOWN_ANSWER_TEXT, citations: [], sufficient: false };
  }

  await recordAiSearchPatterns({
    organizationId: params.organizationId,
    question: params.question,
    citedClauseIds: guard.strongCitations.map((citation) => citation.contractClauseId),
  });

  const messages = buildPromptMessages(params.question, guard.strongCitations);
  const llm = getLlmProvider();
  const cache = getCacheProvider();
  const cacheKey = buildPromptCacheKey(llm, messages);

  let answerText: string;
  const cached = await cache.get(cacheKey);
  if (cached !== undefined) {
    recordCacheEvent("prompt", true);
    answerText = cached;
  } else {
    recordCacheEvent("prompt", false);
    const llmStart = performance.now();
    const result = await llm.generateCompletion(messages);
    recordDependencyLatency("llm", performance.now() - llmStart);
    recordLlmUsage({ promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens });
    answerText = result.text;
    await cache.set(cacheKey, answerText, AI_CACHE_TTL_SECONDS.prompt);
  }

  // §Citation Required - throws (never silently returned) if any paragraph
  // lacks a valid citation marker; the caller must treat this as a hard
  // failure, not degrade to showing an uncited answer. Re-checked even on
  // a cache hit (cheap, pure) as a defense-in-depth invariant.
  assertEveryParagraphHasCitation(answerText, guard.strongCitations);

  return { answerText, citations: guard.strongCitations, sufficient: true };
}

export type AskQuestionStreamEvent =
  | { type: "citations"; citations: Citation[] }
  | { type: "chunk"; text: string }
  | { type: "done"; fullText: string };

/**
 * §Streaming + §Citation Required, together - never in tension: this
 * buffers the LLM's stream and only ever yields a "chunk" event once a
 * FULL paragraph (bounded by a blank line) has been validated by
 * citation-required.ts. A citation-less paragraph aborts the whole
 * generator (throws) BEFORE any part of it reaches the caller - true
 * token-by-token streaming still happens under the hood
 * (LlmProvider.streamCompletion), it just is not what gets forwarded to
 * the client; what the client sees is "as soon as a citation-verified
 * paragraph is ready", which is still substantially more responsive than
 * waiting for the entire answer.
 *
 * §Cache - a prompt-cache hit skips the real LLM call (and its
 * streamCompletion ticks) entirely and yields the cached, already-verified
 * text as a single chunk instead of faking incremental deltas - there is
 * no real latency benefit to pretending it recomputed the answer token by
 * token.
 */
export async function* askQuestionStreaming(params: {
  organizationId: string;
  question: string;
}): AsyncGenerator<AskQuestionStreamEvent> {
  const citations = await retrieveContext({ organizationId: params.organizationId, question: params.question });
  const guard = checkEvidenceSufficiency(citations);

  if (!guard.sufficient) {
    await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
    yield { type: "citations", citations: [] };
    yield { type: "chunk", text: UNKNOWN_ANSWER_TEXT };
    yield { type: "done", fullText: UNKNOWN_ANSWER_TEXT };
    return;
  }

  await recordAiSearchPatterns({
    organizationId: params.organizationId,
    question: params.question,
    citedClauseIds: guard.strongCitations.map((citation) => citation.contractClauseId),
  });

  yield { type: "citations", citations: guard.strongCitations };

  const messages = buildPromptMessages(params.question, guard.strongCitations);
  const llm = getLlmProvider();
  const cache = getCacheProvider();
  const cacheKey = buildPromptCacheKey(llm, messages);

  const cached = await cache.get(cacheKey);
  if (cached !== undefined) {
    recordCacheEvent("prompt", true);
    assertEveryParagraphHasCitation(cached, guard.strongCitations);
    yield { type: "chunk", text: cached };
    yield { type: "done", fullText: cached };
    return;
  }
  recordCacheEvent("prompt", false);

  let paragraphBuffer = "";
  let fullText = "";
  const llmStart = performance.now();

  for await (const delta of llm.streamCompletion(messages)) {
    paragraphBuffer += delta;
    fullText += delta;

    let boundary = paragraphBuffer.indexOf("\n\n");
    while (boundary !== -1) {
      const paragraph = paragraphBuffer.slice(0, boundary).trim();
      paragraphBuffer = paragraphBuffer.slice(boundary + 2);
      if (paragraph.length > 0) {
        assertEveryParagraphHasCitation(paragraph, guard.strongCitations);
        yield { type: "chunk", text: `${paragraph}\n\n` };
      }
      boundary = paragraphBuffer.indexOf("\n\n");
    }
  }

  const trailing = paragraphBuffer.trim();
  if (trailing.length > 0) {
    assertEveryParagraphHasCitation(trailing, guard.strongCitations);
    yield { type: "chunk", text: trailing };
  }

  recordDependencyLatency("llm", performance.now() - llmStart);
  // Streaming providers don't return a usage object the way
  // generateCompletion() does - approximate from the assembled text so
  // Part L's token/cost metrics still accumulate something meaningful for
  // the streaming path too.
  recordLlmUsage({
    promptTokens: Math.ceil(messages.map((m) => m.content).join("\n").length / 4),
    completionTokens: Math.ceil(fullText.length / 4),
  });

  await cache.set(cacheKey, fullText, AI_CACHE_TTL_SECONDS.prompt);

  yield { type: "done", fullText };
}
