import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { hashCacheInput } from "@/domain/ai/cache-key";
import type { Citation } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation, CITATION_VALIDATOR_VERSION } from "@/domain/ai/citation-required";
import { assertQuestionWithinBudget, truncateToContextBudget } from "@/domain/ai/context-budget";
import { checkEvidenceSufficiency, UNKNOWN_ANSWER_TEXT } from "@/domain/ai/hallucination-guard";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import type { LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { buildPromptMessages, PROMPT_TEMPLATE_VERSION } from "@/domain/ai/prompt-builder";
import { getCacheProvider, getCacheStampedeLock } from "@/server/services/ai/cache/get-cache-provider";
import { withDistributedLockOrCompute } from "@/server/services/ai/cache/distributed-lock";
import { withInFlightDeduplication } from "@/server/services/ai/cache/in-flight-deduplication";
import {
  recordAiRequestEnd,
  recordAiRequestStart,
  recordCacheEvent,
  recordCacheStampedeJoined,
  recordContextTruncation,
  recordDependencyLatency,
  recordLatencyBudgetExceeded,
  recordLlmUsage,
} from "@/server/monitoring/metrics";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";

import { recordAiSearchPatterns } from "./record-ai-search-pattern";
import { retrieveContext } from "./retrieve-context";

const DEVELOPMENT_PROVIDER_NAME = "development";

/** §Phase 12.2 Part E (§30) - applies CONTEXT_MAX_CLAUSES to the hallucination guard's already-scored strongCitations, recording a metric (never the dropped content) when truncation actually happens. */
function applyContextBudget(citations: Citation[]): Citation[] {
  const { kept, truncated } = truncateToContextBudget(citations);
  if (truncated) {
    recordContextTruncation();
  }
  return kept;
}

function checkLlmLatencyBudget(durationMs: number, llm: LlmProvider): void {
  if (exceedsLatencyBudget("llm", durationMs, llm.providerName === DEVELOPMENT_PROVIDER_NAME)) {
    recordLatencyBudgetExceeded("llm");
  }
}

/**
 * §Phase 12.2 Part F (§35 stampede) - a token-by-token stream can't be
 * "joined" by a second caller the way a plain Promise can (there is no
 * generic mechanism here to fan a live stream out to multiple readers) -
 * so streaming gets a lighter version of the same protection instead: if
 * another request for the identical prompt-cache key is ALREADY streaming
 * in this process, a second caller waits briefly for the first to finish
 * and populate the cache, then serves the cached result as a single chunk
 * (same shape as an ordinary cache hit) rather than starting its own
 * redundant LLM stream. Bounded, never infinite - falls through to
 * independent streaming if the wait times out (the first stream is
 * unusually slow, or something went wrong with it).
 */
const activeStreamingKeys = new Set<string>();
const STREAM_JOIN_MAX_WAIT_MS = 3000;
const STREAM_JOIN_POLL_INTERVAL_MS = 50;

async function waitForActiveStreamResult(cache: ReturnType<typeof getCacheProvider>, cacheKey: string): Promise<string | undefined> {
  if (!activeStreamingKeys.has(cacheKey)) {
    return undefined;
  }
  recordCacheStampedeJoined();
  const deadline = Date.now() + STREAM_JOIN_MAX_WAIT_MS;
  while (Date.now() < deadline && activeStreamingKeys.has(cacheKey)) {
    await new Promise((resolve) => setTimeout(resolve, STREAM_JOIN_POLL_INTERVAL_MS));
  }
  return cache.get(cacheKey);
}

export interface AskQuestionResult {
  answerText: string;
  citations: Citation[];
  sufficient: boolean;
}

/**
 * §Cache (Phase 12 Part N), extended §Phase 12.2 Part F (§34) - prompt/LLM
 * cache key. The full prompt (system + user messages, which already embed
 * every citation's evidence text and the question) is the cache's own
 * natural invalidation boundary for MOST changes: any change to the
 * question OR the retrieved citations produces a different key
 * automatically. `PROMPT_TEMPLATE_VERSION`/`CITATION_VALIDATOR_VERSION`
 * are still included EXPLICITLY (not just relied upon via content hashing)
 * per §34 - a version bump that does NOT change buildPromptMessages()'s
 * actual output text (e.g. a version bump alongside an unrelated internal
 * refactor) would otherwise produce byte-identical serialized messages and
 * silently keep serving an answer generated under a prior guard/template
 * "version," even though the version number itself changed.
 */
function buildPromptCacheKey(llm: LlmProvider, messages: readonly LlmMessage[]): string {
  const serialized = messages.map((message) => `${message.role}:${message.content}`).join("\n---\n");
  return (
    `prompt:${llm.providerName}:${llm.modelName}:p${PROMPT_TEMPLATE_VERSION}:` +
    `c${CITATION_VALIDATOR_VERSION}:${hashCacheInput(serialized)}`
  );
}

/**
 * Non-streaming entry point - used by the evaluation CLI (Part J, which
 * needs one final string per golden-dataset question, not a live stream)
 * and by anywhere else that just wants a complete answer.
 */
export async function askQuestion(params: { organizationId: string; question: string }): Promise<AskQuestionResult> {
  assertQuestionWithinBudget(params.question);
  recordAiRequestStart();
  try {
    const citations = await retrieveContext({ organizationId: params.organizationId, question: params.question });
    const guard = checkEvidenceSufficiency(citations);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      return { answerText: UNKNOWN_ANSWER_TEXT, citations: [], sufficient: false };
    }

    const contextCitations = applyContextBudget(guard.strongCitations);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId),
    });

    const messages = buildPromptMessages(params.question, contextCitations);
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

      const computeAnswer = async (): Promise<string> => {
        const llmStart = performance.now();
        const result = await llm.generateCompletion(messages);
        const llmDurationMs = performance.now() - llmStart;
        recordDependencyLatency("llm", llmDurationMs);
        checkLlmLatencyBudget(llmDurationMs, llm);
        recordLlmUsage({
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          provider: llm.providerName,
          model: llm.modelName,
        });
        await cache.set(cacheKey, result.text, AI_CACHE_TTL_SECONDS.prompt);
        return result.text;
      };

      // §Phase 12.2 Part F (§35 stampede) - the LLM call is the single
      // most expensive step in this whole pipeline (latency AND $ cost),
      // so it gets BOTH layers: in-process single-flight always, plus a
      // cross-instance Redis lock when AI_CACHE_PROVIDER=redis.
      answerText = await withInFlightDeduplication(cacheKey, async () => {
        const lock = getCacheStampedeLock();
        if (!lock) {
          return computeAnswer();
        }
        return withDistributedLockOrCompute(lock, cacheKey, 30, () => cache.get(cacheKey), computeAnswer);
      });
    }

    // §Citation Required - throws (never silently returned) if any paragraph
    // lacks a valid citation marker; the caller must treat this as a hard
    // failure, not degrade to showing an uncited answer. Re-checked even on
    // a cache hit (cheap, pure) as a defense-in-depth invariant.
    assertEveryParagraphHasCitation(answerText, contextCitations);

    return { answerText, citations: contextCitations, sufficient: true };
  } finally {
    recordAiRequestEnd();
  }
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
  assertQuestionWithinBudget(params.question);
  recordAiRequestStart();
  try {
    const citations = await retrieveContext({ organizationId: params.organizationId, question: params.question });
    const guard = checkEvidenceSufficiency(citations);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      yield { type: "citations", citations: [] };
      yield { type: "chunk", text: UNKNOWN_ANSWER_TEXT };
      yield { type: "done", fullText: UNKNOWN_ANSWER_TEXT };
      return;
    }

    const contextCitations = applyContextBudget(guard.strongCitations);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId),
    });

    yield { type: "citations", citations: contextCitations };

    const messages = buildPromptMessages(params.question, contextCitations);
    const llm = getLlmProvider();
    const cache = getCacheProvider();
    const cacheKey = buildPromptCacheKey(llm, messages);

    const cached = await cache.get(cacheKey);
    if (cached !== undefined) {
      recordCacheEvent("prompt", true);
      assertEveryParagraphHasCitation(cached, contextCitations);
      yield { type: "chunk", text: cached };
      yield { type: "done", fullText: cached };
      return;
    }

    // §Phase 12.2 Part F (§35) - see waitForActiveStreamResult()'s own
    // docstring: join an already-in-flight identical stream (bounded wait)
    // rather than starting a second redundant LLM stream.
    const joined = await waitForActiveStreamResult(cache, cacheKey);
    if (joined !== undefined) {
      recordCacheEvent("prompt", true);
      assertEveryParagraphHasCitation(joined, contextCitations);
      yield { type: "chunk", text: joined };
      yield { type: "done", fullText: joined };
      return;
    }

    recordCacheEvent("prompt", false);
    activeStreamingKeys.add(cacheKey);

    let paragraphBuffer = "";
    let fullText = "";
    const llmStart = performance.now();

    try {
      for await (const delta of llm.streamCompletion(messages)) {
        paragraphBuffer += delta;
        fullText += delta;

        let boundary = paragraphBuffer.indexOf("\n\n");
        while (boundary !== -1) {
          const paragraph = paragraphBuffer.slice(0, boundary).trim();
          paragraphBuffer = paragraphBuffer.slice(boundary + 2);
          if (paragraph.length > 0) {
            assertEveryParagraphHasCitation(paragraph, contextCitations);
            yield { type: "chunk", text: `${paragraph}\n\n` };
          }
          boundary = paragraphBuffer.indexOf("\n\n");
        }
      }

      const trailing = paragraphBuffer.trim();
      if (trailing.length > 0) {
        assertEveryParagraphHasCitation(trailing, contextCitations);
        yield { type: "chunk", text: trailing };
      }
    } finally {
      activeStreamingKeys.delete(cacheKey);
    }

    const llmDurationMs = performance.now() - llmStart;
    recordDependencyLatency("llm", llmDurationMs);
    checkLlmLatencyBudget(llmDurationMs, llm);
    // Streaming providers don't return a usage object the way
    // generateCompletion() does - approximate from the assembled text so
    // Part L's token/cost metrics still accumulate something meaningful for
    // the streaming path too.
    recordLlmUsage({
      promptTokens: Math.ceil(messages.map((m) => m.content).join("\n").length / 4),
      completionTokens: Math.ceil(fullText.length / 4),
      provider: llm.providerName,
      model: llm.modelName,
    });

    await cache.set(cacheKey, fullText, AI_CACHE_TTL_SECONDS.prompt);

    yield { type: "done", fullText };
  } finally {
    recordAiRequestEnd();
  }
}
