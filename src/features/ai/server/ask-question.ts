import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { AiBudgetExceededError } from "@/domain/ai/ai-budget-error";
import { AI_USAGE_OPERATION_TYPES } from "@/domain/ai/ai-usage-operation";
import { hashCacheInput } from "@/domain/ai/cache-key";
import type { Citation } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation, CITATION_VALIDATOR_VERSION } from "@/domain/ai/citation-required";
import { assertQuestionWithinBudget } from "@/domain/ai/context-budget";
import { packCitationsWithinTokenBudget } from "@/domain/ai/context-token-budget";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { checkEvidenceSufficiency, UNKNOWN_ANSWER_TEXT } from "@/domain/ai/hallucination-guard";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import type { LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { buildPromptMessages, PROMPT_TEMPLATE_VERSION } from "@/domain/ai/prompt-builder";
import { normalizeProviderError } from "@/domain/ai/provider-error";
import { getCacheProvider, getCacheStampedeLock } from "@/server/services/ai/cache/get-cache-provider";
import { withDistributedLockOrCompute } from "@/server/services/ai/cache/distributed-lock";
import { withInFlightDeduplication } from "@/server/services/ai/cache/in-flight-deduplication";
import {
  recordAiRequestEnd,
  recordAiRequestStart,
  recordCacheEvent,
  recordCacheStampedeJoined,
  recordContextTokenUsage,
  recordContextTruncation,
  recordDependencyLatency,
  recordLatencyBudgetExceeded,
  recordLlmUsage,
} from "@/server/monitoring/metrics";
import { AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE } from "@/lib/config/ai-budget";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "@/server/services/ai/budget/reserve-ai-budget";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";
import { getEmbeddingProviderForOrganization } from "@/server/services/ai/get-embedding-provider-for-organization";
import { getLlmProviderForOrganization } from "@/server/services/ai/get-llm-provider-for-organization";
import { loadOrganizationAiContext } from "@/server/services/ai/load-organization-ai-context";
import { isFallbackLlmProvider } from "@/server/services/ai/providers/fallback-llm-provider";
import { recordAiUsageBestEffort } from "@/server/services/ai/record-ai-usage-best-effort";

import { recordAiSearchPatterns } from "./record-ai-search-pattern";
import { maybeDispatchShadowEvaluation } from "./run-shadow-evaluation";
import { retrieveContext } from "./retrieve-context";

const DEVELOPMENT_PROVIDER_NAME = "development";

/**
 * §Phase 13 Part G (§27) - a conservative WORST-CASE cost estimate used
 * only to size the pre-call budget reservation (never the number actually
 * recorded in AiUsageRecord, which always uses the real reported/derived
 * usage - see settleLlmBudgetAndUsage() below). Input tokens are estimated
 * from the built prompt's own length (already known before the call);
 * output tokens use a fixed worst-case ceiling since the real completion
 * length isn't known until the call finishes.
 */
async function reserveLlmBudget(params: {
  organizationId: string;
  llm: LlmProvider;
  effectiveProviderName: string;
  messages: LlmMessage[];
}) {
  const estimatedInputTokens = Math.ceil(params.messages.map((m) => m.content).join("\n").length / 4);
  const estimate = estimateAiCostMinor({
    provider: params.effectiveProviderName,
    model: params.llm.modelName,
    inputTokens: estimatedInputTokens,
    outputTokens: AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE,
  });
  return reserveAiBudget({
    organizationId: params.organizationId,
    maxEstimatedCostMinor: estimate.estimatedCostMinor ?? BigInt(0),
  });
}

/**
 * §Phase 14.1 §5 - packs the hallucination guard's already-scored
 * strongCitations into the real token budget (packCitationsWithinTokenBudget),
 * replacing the old fixed CONTEXT_MAX_CLAUSES=8 slice. Recording a metric
 * (never the dropped content, never the exact token count itself here -
 * that's `totalContextTokens`, recorded separately) when truncation
 * actually happens.
 */
function applyContextBudget(question: string, citations: Citation[]): Citation[] {
  const { kept, truncated, totalContextTokens } = packCitationsWithinTokenBudget(question, citations);
  if (truncated) {
    recordContextTruncation();
  }
  recordContextTokenUsage(totalContextTokens);
  return kept;
}

function checkLlmLatencyBudget(durationMs: number, llm: LlmProvider): void {
  if (exceedsLatencyBudget("llm", durationMs, llm.providerName === DEVELOPMENT_PROVIDER_NAME)) {
    recordLatencyBudgetExceeded("llm");
  }
}

/**
 * §Phase 13 Part G (§22), extended §Phase 13.1 Part 10/11 - resolved fresh
 * per call (never cached), matching route.ts's own provenance-stamping
 * rationale: an AiUsageRecord/Message must reflect whatever config
 * actually served THIS request. `embeddingProvider` is the ACTUALLY-ROUTED
 * provider (primary or canary - see get-embedding-provider-for-organization.ts),
 * never a fresh call to the primary singleton factory, so a canary-routed
 * request's provenance never misreports the primary's identity.
 */
async function currentAiConfigIdentity(embeddingProvider: EmbeddingProvider): Promise<{ aiConfigVersion: string; aiConfigChecksum: string }> {
  const config = getAiRuntimeConfiguration({ embeddingProvider });
  return { aiConfigVersion: config.version, aiConfigChecksum: config.checksum };
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
export async function askQuestion(params: { organizationId: string; question: string; userId?: string }): Promise<AskQuestionResult> {
  assertQuestionWithinBudget(params.question);
  recordAiRequestStart();
  try {
    // §Phase 13.1 Part 10/11 - ONE org-context fetch (DB policy + env
    // rollout config) drives BOTH the embedding and LLM routing decisions,
    // so an org's canary bucket is resolved identically for its retrieval
    // leg and its completion leg (askQuestion() is only used by the
    // evaluation CLI - see this function's own docstring - which does not
    // need the per-request budget reservation askQuestionStreaming()
    // applies for real interactive traffic, but still must never send data
    // to a real/canary provider for a policy-disabled organization).
    const aiContext = await loadOrganizationAiContext(params.organizationId);
    const embeddingSelection = getEmbeddingProviderForOrganization({ organizationId: params.organizationId, ...aiContext });
    const llmSelection = getLlmProviderForOrganization({ organizationId: params.organizationId, ...aiContext });
    const llm = llmSelection.provider;

    const citations = await retrieveContext({
      organizationId: params.organizationId,
      question: params.question,
      embeddingProvider: embeddingSelection.provider,
    });
    const guard = checkEvidenceSufficiency(citations);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      return { answerText: UNKNOWN_ANSWER_TEXT, citations: [], sufficient: false };
    }

    const contextCitations = applyContextBudget(params.question, guard.strongCitations);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId).filter((id) => id !== null),
    });

    const messages = buildPromptMessages(params.question, contextCitations);
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
        let result;
        try {
          result = await llm.generateCompletion(messages);
        } catch (rawError) {
          const error = normalizeProviderError({ error: rawError, providerName: llm.providerName });
          await recordAiUsageBestEffort({
            organizationId: params.organizationId,
            userId: params.userId,
            operationType: AI_USAGE_OPERATION_TYPES.LLM_ASK,
            provider: llm.providerName,
            model: llm.modelName,
            latencyMs: Math.round(performance.now() - llmStart),
            success: false,
            errorCode: error.errorCode,
            ...(await currentAiConfigIdentity(embeddingSelection.provider)),
          });
          throw error;
        }
        const llmDurationMs = performance.now() - llmStart;
        recordDependencyLatency("llm", llmDurationMs);
        checkLlmLatencyBudget(llmDurationMs, llm);
        const servedProvider = result.servedByProviderName ?? llm.providerName;
        const servedModel = result.servedByModelName ?? llm.modelName;
        recordLlmUsage({
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          provider: servedProvider,
          model: servedModel,
        });
        const cost = estimateAiCostMinor({
          provider: servedProvider,
          model: servedModel,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
        });
        await recordAiUsageBestEffort({
          organizationId: params.organizationId,
          userId: params.userId,
          operationType: AI_USAGE_OPERATION_TYPES.LLM_ASK,
          provider: servedProvider,
          model: servedModel,
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          estimatedCostMinor: cost.estimatedCostMinor,
          currency: cost.currency,
          latencyMs: Math.round(llmDurationMs),
          success: true,
          fallbackUsed: result.servedByProviderName !== undefined,
          canaryUsed: llmSelection.group === "canary",
          ...(await currentAiConfigIdentity(embeddingSelection.provider)),
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
  /** §Phase 13.1 Part 11 - `canaryUsed` is omitted (not false) when no completion was actually generated (the hallucination guard short-circuited before any provider call) - undefined means "not applicable," never "definitely primary." */
  | { type: "done"; fullText: string; canaryUsed?: boolean };

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
  requestId?: string;
  userId?: string;
  conversationId?: string;
}): AsyncGenerator<AskQuestionStreamEvent> {
  assertQuestionWithinBudget(params.question);
  recordAiRequestStart();
  try {
    // §Phase 13.1 Part 10/11 - see askQuestion()'s identical comment: one
    // org-context fetch drives BOTH the embedding leg's and the LLM leg's
    // routing (primary vs. canary vs. policy-refused), so an organization
    // with the embedding leg allowed but the LLM leg disallowed (or vice
    // versa) is still caught before any provider call, and an org in
    // canary is in canary for both legs consistently.
    const aiContext = await loadOrganizationAiContext(params.organizationId);
    const embeddingSelection = getEmbeddingProviderForOrganization({ organizationId: params.organizationId, ...aiContext });
    const llmSelection = getLlmProviderForOrganization({ organizationId: params.organizationId, ...aiContext });
    const llm = llmSelection.provider;

    const citations = await retrieveContext({
      organizationId: params.organizationId,
      question: params.question,
      embeddingProvider: embeddingSelection.provider,
    });
    const guard = checkEvidenceSufficiency(citations);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      yield { type: "citations", citations: [] };
      yield { type: "chunk", text: UNKNOWN_ANSWER_TEXT };
      yield { type: "done", fullText: UNKNOWN_ANSWER_TEXT };
      return;
    }

    const contextCitations = applyContextBudget(params.question, guard.strongCitations);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId).filter((id) => id !== null),
    });

    yield { type: "citations", citations: contextCitations };

    const messages = buildPromptMessages(params.question, contextCitations);
    const cache = getCacheProvider();
    const cacheKey = buildPromptCacheKey(llm, messages);

    const cached = await cache.get(cacheKey);
    if (cached !== undefined) {
      recordCacheEvent("prompt", true);
      assertEveryParagraphHasCitation(cached, contextCitations);
      yield { type: "chunk", text: cached };
      // §Phase 13.1 Part 11 - the cache key already embeds llm.providerName/
      // modelName (buildPromptCacheKey), so a hit under the CURRENT
      // selection's key can only ever have been written by that identical
      // provider identity - canaryUsed reflects the currently-resolved
      // group, which is guaranteed consistent with whichever call wrote it.
      yield { type: "done", fullText: cached, canaryUsed: llmSelection.group === "canary" };
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
      yield { type: "done", fullText: joined, canaryUsed: llmSelection.group === "canary" };
      return;
    }

    recordCacheEvent("prompt", false);

    // §Phase 13 Part G (§27) - the peeked identity (see
    // FallbackLlmProvider.peekEffectiveIdentity()'s own docstring for the
    // "sustained outage, not perfectly race-free" caveat) sizes the
    // worst-case cost reservation against whichever provider will likely
    // actually serve this request.
    const effectiveIdentity = isFallbackLlmProvider(llm)
      ? await llm.peekEffectiveIdentity()
      : { providerName: llm.providerName, modelName: llm.modelName };
    const budgetOutcome = await reserveLlmBudget({
      organizationId: params.organizationId,
      llm,
      effectiveProviderName: effectiveIdentity.providerName,
      messages,
    });
    if (!budgetOutcome.allowed) {
      throw new AiBudgetExceededError();
    }
    const reservation = budgetOutcome.reservation;

    activeStreamingKeys.add(cacheKey);

    let paragraphBuffer = "";
    let fullText = "";
    const llmStart = performance.now();
    let reportedUsage: { inputTokens: number; outputTokens: number } | undefined;
    let servedByProviderName: string | undefined;
    let servedByModelName: string | undefined;

    try {
      try {
        for await (const event of llm.stream(messages, { requestId: params.requestId })) {
          if (event.type === "text-delta") {
            paragraphBuffer += event.text;
            fullText += event.text;

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
          } else if (event.type === "usage") {
            reportedUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          } else if (event.type === "done") {
            servedByProviderName = event.servedByProviderName;
            servedByModelName = event.servedByModelName;
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
    } catch (rawError) {
      const error = normalizeProviderError({ error: rawError, providerName: llm.providerName });
      await releaseAiBudget(reservation);
      await recordAiUsageBestEffort({
        organizationId: params.organizationId,
        userId: params.userId,
        conversationId: params.conversationId,
        operationType: AI_USAGE_OPERATION_TYPES.LLM_ASK_STREAM,
        provider: llm.providerName,
        model: llm.modelName,
        latencyMs: Math.round(performance.now() - llmStart),
        success: false,
        errorCode: error.errorCode,
        ...(await currentAiConfigIdentity(embeddingSelection.provider)),
      });
      throw rawError;
    }

    const llmDurationMs = performance.now() - llmStart;
    recordDependencyLatency("llm", llmDurationMs);
    checkLlmLatencyBudget(llmDurationMs, llm);
    // §Phase 13 Part D - a real provider's `usage` stream event (when it
    // sends one) replaces the previous chars/4 approximation; only a
    // provider that genuinely never reports streaming usage (none of the
    // real providers wired in this phase - see each provider's own
    // stream() implementation) falls back to the approximation.
    const usage = reportedUsage ?? {
      inputTokens: Math.ceil(messages.map((m) => m.content).join("\n").length / 4),
      outputTokens: Math.ceil(fullText.length / 4),
    };
    const servedProvider = servedByProviderName ?? llm.providerName;
    const servedModel = servedByModelName ?? llm.modelName;
    recordLlmUsage({
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      provider: servedProvider,
      model: servedModel,
    });
    const cost = estimateAiCostMinor({
      provider: servedProvider,
      model: servedModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    await settleAiBudget(reservation, cost.estimatedCostMinor);
    await recordAiUsageBestEffort({
      organizationId: params.organizationId,
      userId: params.userId,
      conversationId: params.conversationId,
      operationType: AI_USAGE_OPERATION_TYPES.LLM_ASK_STREAM,
      provider: servedProvider,
      model: servedModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostMinor: cost.estimatedCostMinor,
      currency: cost.currency,
      latencyMs: Math.round(llmDurationMs),
      success: true,
      fallbackUsed: servedByProviderName !== undefined,
      canaryUsed: llmSelection.group === "canary",
      ...(await currentAiConfigIdentity(embeddingSelection.provider)),
    });

    await cache.set(cacheKey, fullText, AI_CACHE_TTL_SECONDS.prompt);

    // §Phase 13 Part F (§20) - fire-and-forget, never awaited: must not add
    // latency to the response the user is actually waiting on. See
    // maybeDispatchShadowEvaluation()'s own docstring for why every
    // failure mode inside it is swallowed rather than propagated here.
    maybeDispatchShadowEvaluation({ organizationId: params.organizationId, messages, contextCitations });

    yield { type: "done", fullText, canaryUsed: llmSelection.group === "canary" };
  } finally {
    recordAiRequestEnd();
  }
}
