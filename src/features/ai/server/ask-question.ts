import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { AiBudgetExceededError } from "@/domain/ai/ai-budget-error";
import { classifyAiStreamError } from "@/domain/ai/ai-stream-error";
import { AI_USAGE_OPERATION_TYPES } from "@/domain/ai/ai-usage-operation";
import { filterCitationsToAnswerUsed } from "@/domain/ai/answer-used-citations";
import { selectBroadIssueCandidates } from "@/domain/ai/broad-issue-selection";
import { hashCacheInput } from "@/domain/ai/cache-key";
import type { Citation } from "@/domain/ai/citation";
import {
  assertAnswerBlockGrounded,
  assertAnswerGrounded,
  CITATION_VALIDATOR_VERSION,
  parseAnswerBlock,
} from "@/domain/ai/citation-required";
import { assertQuestionWithinBudget } from "@/domain/ai/context-budget";
import { packCitationsWithinTokenBudget } from "@/domain/ai/context-token-budget";
import type { ConversationTurn } from "@/domain/ai/conversation-context";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { checkEvidenceSufficiency, UNKNOWN_ANSWER_TEXT } from "@/domain/ai/hallucination-guard";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import type { LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { buildPromptMessages, PROMPT_TEMPLATE_VERSION } from "@/domain/ai/prompt-builder";
import { normalizeProviderError } from "@/domain/ai/provider-error";
import { classifyQuestionComplexity, type QuestionComplexity } from "@/domain/ai/question-complexity";
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
  recordEvidenceDistribution,
  recordLatencyBudgetExceeded,
  recordLlmUsage,
} from "@/server/monitoring/metrics";
import { AI_LLM_DEFAULT_MAX_OUTPUT_TOKENS_ESTIMATE } from "@/lib/config/ai-budget";
import { releaseAiBudget, reserveAiBudget, settleAiBudget } from "@/server/services/ai/budget/reserve-ai-budget";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";
import { getEmbeddingProviderForOrganization } from "@/server/services/ai/get-embedding-provider-for-organization";
import { getLlmProviderForOrganization } from "@/server/services/ai/get-llm-provider-for-organization";
import { loadOrganizationAiContext } from "@/server/services/ai/load-organization-ai-context";
import { getLogger } from "@/server/logging";
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
function applyContextBudget(question: string, citations: Citation[], complexity: QuestionComplexity): Citation[] {
  const { kept, truncated, totalContextTokens } = packCitationsWithinTokenBudget(question, citations, undefined, complexity);
  if (truncated) {
    recordContextTruncation();
  }
  recordContextTokenUsage(totalContextTokens);
  recordEvidenceDistribution({
    clause: kept.filter((c) => c.evidenceType === "clause").length,
    chunk: kept.filter((c) => c.evidenceType === "chunk").length,
  });
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
 * §Cache (Phase 12 Part N), extended §Phase 12.2 Part F (§34), extended
 * §Phase 14.1 §19 - prompt/LLM cache key. The full prompt (system + user
 * messages, which already embed every citation's evidence text and the
 * question) is the cache's own natural invalidation boundary for MOST
 * changes: any change to the question OR the retrieved citations produces
 * a different key automatically. `PROMPT_TEMPLATE_VERSION`/
 * `CITATION_VALIDATOR_VERSION` are still included EXPLICITLY (not just
 * relied upon via content hashing) per §34 - a version bump that does NOT
 * change buildPromptMessages()'s actual output text (e.g. a version bump
 * alongside an unrelated internal refactor) would otherwise produce
 * byte-identical serialized messages and silently keep serving an answer
 * generated under a prior guard/template "version," even though the
 * version number itself changed.
 *
 * `organizationId` is included EXPLICITLY too, even though it is not
 * strictly needed for correctness today (two organizations with
 * byte-identical contract text and an identical question would produce an
 * identical, and identically-correct, answer either way - see
 * tests/integration/ai-chunk-tenant-isolation.test.ts's decoy-org
 * fixture for exactly that scenario). §21's "cache keys must include
 * org/contract scope... never share across orgs" is a structural
 * requirement, not a "safe in practice" one - relying on content
 * happening to differ across every real organization pair forever is not
 * the same guarantee as the key itself being org-scoped.
 */
function buildPromptCacheKey(organizationId: string, llm: LlmProvider, messages: readonly LlmMessage[]): string {
  const serialized = messages.map((message) => `${message.role}:${message.content}`).join("\n---\n");
  return (
    `prompt:${organizationId}:${llm.providerName}:${llm.modelName}:p${PROMPT_TEMPLATE_VERSION}:` +
    `c${CITATION_VALIDATOR_VERSION}:${hashCacheInput(serialized)}`
  );
}

/**
 * Non-streaming entry point - used by the evaluation CLI (Part J, which
 * needs one final string per golden-dataset question, not a live stream)
 * and by anywhere else that just wants a complete answer.
 */
export async function askQuestion(params: {
  organizationId: string;
  question: string;
  userId?: string;
  /** §AI 상담 개편 - when set, restricts retrieval to this one contract; the caller must have already verified it belongs to organizationId (see src/app/api/ai/ask/route.ts). */
  contractId?: string;
  /** §AI 답변 품질 개편 P0-1 - bounded, already-authorized recent turns (see conversation-context.ts). Never trusted from the client - the caller must have loaded this via listMessagesForConversation()'s own org/user/contract scoping. Defaults to none (the evaluation CLI and most callers have no conversation). */
  history?: readonly ConversationTurn[];
}): Promise<AskQuestionResult> {
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

    const history = params.history ?? [];
    const citations = await retrieveContext({
      organizationId: params.organizationId,
      question: params.question,
      embeddingProvider: embeddingSelection.provider,
      contractId: params.contractId,
      history,
    });
    const complexity = classifyQuestionComplexity(params.question);
    const guard = checkEvidenceSufficiency(citations, complexity);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      return { answerText: UNKNOWN_ANSWER_TEXT, citations: [], sufficient: false };
    }

    const contextCitations = applyContextBudget(params.question, guard.strongCitations, complexity);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId).filter((id) => id !== null),
    });

    // §AI 답변 품질 개편 Phase 1.4.3 - see broad-issue-selection.ts's own
    // docstring. `contextCitations` above stays the FULL budgeted set
    // (still used for search-pattern recording and shadow evaluation -
    // "retrieval remains broad internally"); `synthesisCitations` is what
    // actually reaches the prompt/grounding/filtering below, structurally
    // bounded for a comprehensive question (a no-op for "focused", and a
    // no-op for an explicit exhaustive-review request even when
    // "comprehensive" - see selectBroadIssueCandidates()).
    const broadSelection =
      complexity === "comprehensive"
        ? selectBroadIssueCandidates({ question: params.question, citations: contextCitations })
        : null;
    const synthesisCitations = broadSelection ? broadSelection.selectedCitations : contextCitations;
    // §AI 답변 품질 개편 Phase 1.4.4 - the explicit per-issue skeleton
    // (see prompt-builder.ts's buildIssueSkeletonSection()) only applies
    // to a genuinely BOUNDED selection - an exhaustive-review request
    // already returns every group unchanged and gets no fixed-N template.
    const issueGroups = broadSelection && !broadSelection.exhaustive ? broadSelection.selectedGroups : undefined;

    const messages = buildPromptMessages(params.question, synthesisCitations, history, complexity, issueGroups);
    const cache = getCacheProvider();
    const cacheKey = buildPromptCacheKey(params.organizationId, llm, messages);

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

    // §Citation Required / §AI 답변 품질 개편 P0-4 - throws (never silently
    // returned) if any EVIDENCE block (or an untagged paragraph, the
    // fail-safe default) lacks a valid citation marker, or if any block of
    // any type contains a fabricated one; the caller must treat this as a
    // hard failure, not degrade to showing an uncited/hallucinated answer.
    // Re-checked even on a cache hit (cheap, pure) as a defense-in-depth
    // invariant. Returns the tag-stripped, user-facing text - the cached
    // value itself stays the raw tagged completion (see buildPromptCacheKey's
    // cache.set() above), so a cache hit is re-validated/re-stripped exactly
    // like a fresh completion, never storing two divergent representations.
    // §AI 답변 품질 개편 Phase 1.4.3 - validated against `synthesisCitations`
    // (what the model was ACTUALLY shown), never the broader
    // `contextCitations` - a marker resolving to something outside what
    // this prompt supplied must fail exactly like any other hallucination,
    // even if that something was real, retrieved evidence the model just
    // never saw in THIS call.
    const groundedAnswerText = assertAnswerGrounded(answerText, synthesisCitations);

    // §AI 답변 품질 개편 Phase 1.4 - `result.citations` is the ANSWER-USED
    // subset (what the text actually references), never the full
    // `contextCitations` the LLM merely had available - see
    // answer-used-citations.ts's own docstring for the measured problem
    // this fixes (Phase 1.3's real-OpenAI eval).
    const usedCitations = filterCitationsToAnswerUsed(groundedAnswerText, synthesisCitations);

    return { answerText: groundedAnswerText, citations: usedCitations, sufficient: true };
  } finally {
    recordAiRequestEnd();
  }
}

export type AskQuestionStreamEvent =
  /** §AI 답변 품질 개편 Phase 1.4 - emitted EARLY (before any generation), so this is always the full RETRIEVED/context set, never the answer-used one - the answer doesn't exist yet at this point in the stream. A progressive UI hint only; the "done" event's own `citations` field below is the one that should drive the FINAL rendered/persisted citation list. */
  | { type: "citations"; citations: Citation[] }
  | { type: "chunk"; text: string }
  /**
   * §Phase 13.1 Part 11 - `canaryUsed` is omitted (not false) when no completion was actually generated (the hallucination guard short-circuited before any provider call) - undefined means "not applicable," never "definitely primary."
   * §AI 답변 품질 개편 Phase 1.4 - `citations` here is the ANSWER-USED subset (see answer-used-citations.ts), computed once the full grounded text is known - this, not the early "citations" event above, is what a caller should persist/render as this answer's final evidence.
   */
  | { type: "done"; fullText: string; citations: Citation[]; canaryUsed?: boolean };

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
  /** §AI 상담 개편 - when set, restricts retrieval to this one contract; the caller must have already verified it belongs to organizationId (see src/app/api/ai/ask/route.ts). */
  contractId?: string;
  /** §AI 답변 품질 개편 P0-1 - bounded, already-authorized recent turns (see conversation-context.ts). Never trusted from the client - the caller (src/app/api/ai/ask/route.ts) must have loaded this via listMessagesForConversation()'s own org/user/contract scoping. */
  history?: readonly ConversationTurn[];
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

    const history = params.history ?? [];
    const citations = await retrieveContext({
      organizationId: params.organizationId,
      question: params.question,
      embeddingProvider: embeddingSelection.provider,
      contractId: params.contractId,
      history,
    });
    const complexity = classifyQuestionComplexity(params.question);
    const guard = checkEvidenceSufficiency(citations, complexity);

    if (!guard.sufficient) {
      await recordAiSearchPatterns({ organizationId: params.organizationId, question: params.question, citedClauseIds: [] });
      yield { type: "citations", citations: [] };
      yield { type: "chunk", text: UNKNOWN_ANSWER_TEXT };
      yield { type: "done", fullText: UNKNOWN_ANSWER_TEXT, citations: [] };
      return;
    }

    const contextCitations = applyContextBudget(params.question, guard.strongCitations, complexity);

    await recordAiSearchPatterns({
      organizationId: params.organizationId,
      question: params.question,
      citedClauseIds: contextCitations.map((citation) => citation.contractClauseId).filter((id) => id !== null),
    });

    // §AI 답변 품질 개편 Phase 1.4.3 - the early "citations" event below
    // deliberately still shows the FULL `contextCitations` (a progressive
    // "what was retrieved" preview - see AskQuestionStreamEvent's own
    // docstring), never the narrower synthesis set - see askQuestion()'s
    // identical comment for the full rationale.
    yield { type: "citations", citations: contextCitations };

    const broadSelection =
      complexity === "comprehensive"
        ? selectBroadIssueCandidates({ question: params.question, citations: contextCitations })
        : null;
    const synthesisCitations = broadSelection ? broadSelection.selectedCitations : contextCitations;
    // §AI 답변 품질 개편 Phase 1.4.4 - see askQuestion()'s identical comment.
    const issueGroups = broadSelection && !broadSelection.exhaustive ? broadSelection.selectedGroups : undefined;

    const messages = buildPromptMessages(params.question, synthesisCitations, history, complexity, issueGroups);
    const cache = getCacheProvider();
    const cacheKey = buildPromptCacheKey(params.organizationId, llm, messages);

    // §AI 답변 품질 개편 P0-4 - a cache hit stores the RAW (tag-included)
    // completion (see cache.set() below), so it is re-validated/re-stripped
    // here via assertAnswerGrounded() exactly like a fresh completion -
    // never two divergent representations of "what a cache hit looks like"
    // depending on whether the tags were already stripped before caching.
    const cached = await cache.get(cacheKey);
    if (cached !== undefined) {
      recordCacheEvent("prompt", true);
      const groundedCached = assertAnswerGrounded(cached, synthesisCitations);
      yield { type: "chunk", text: groundedCached };
      // §Phase 13.1 Part 11 - the cache key already embeds llm.providerName/
      // modelName (buildPromptCacheKey), so a hit under the CURRENT
      // selection's key can only ever have been written by that identical
      // provider identity - canaryUsed reflects the currently-resolved
      // group, which is guaranteed consistent with whichever call wrote it.
      yield {
        type: "done",
        fullText: groundedCached,
        citations: filterCitationsToAnswerUsed(groundedCached, synthesisCitations),
        canaryUsed: llmSelection.group === "canary",
      };
      return;
    }

    // §Phase 12.2 Part F (§35) - see waitForActiveStreamResult()'s own
    // docstring: join an already-in-flight identical stream (bounded wait)
    // rather than starting a second redundant LLM stream.
    const joined = await waitForActiveStreamResult(cache, cacheKey);
    if (joined !== undefined) {
      recordCacheEvent("prompt", true);
      const groundedJoined = assertAnswerGrounded(joined, synthesisCitations);
      yield { type: "chunk", text: groundedJoined };
      yield {
        type: "done",
        fullText: groundedJoined,
        citations: filterCitationsToAnswerUsed(groundedJoined, synthesisCitations),
        canaryUsed: llmSelection.group === "canary",
      };
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
    // §AI 답변 품질 개편 P0-4 - `fullText` accumulates the RAW (tag-included)
    // stream, exactly as before, and is what gets cached (cache.set() below)
    // so a future cache hit re-validates/re-strips consistently (see the
    // cache-hit branches above). `groundedFullText` accumulates only the
    // tag-stripped text already yielded to the client - what actually gets
    // persisted as the Message's content and reported in the "done" event.
    let fullText = "";
    let groundedFullText = "";
    const llmStart = performance.now();
    let reportedUsage: { inputTokens: number; outputTokens: number } | undefined;
    let servedByProviderName: string | undefined;
    let servedByModelName: string | undefined;
    // §Production Smoke 2026-09-08 finding - minimal, metadata-only stream
    // telemetry (never prompt/question/answer/citation content) so a failed
    // stream's ai_stream.failed log (see the catch below) can say WHERE it
    // failed without needing to guess from Vercel platform logs after the
    // fact.
    let streamStage: "before_open" | "opened" | "receiving" | "completed" = "before_open";
    let chunksEmitted = 0;
    let providerRequestId: string | undefined;

    try {
      try {
        for await (const event of llm.stream(messages, { requestId: params.requestId })) {
          streamStage = streamStage === "before_open" ? "opened" : "receiving";
          if (event.type === "provider-request-id") {
            providerRequestId = event.value;
          } else if (event.type === "text-delta") {
            paragraphBuffer += event.text;
            fullText += event.text;

            let boundary = paragraphBuffer.indexOf("\n\n");
            while (boundary !== -1) {
              const rawParagraph = paragraphBuffer.slice(0, boundary).trim();
              paragraphBuffer = paragraphBuffer.slice(boundary + 2);
              if (rawParagraph.length > 0) {
                // §AI 답변 품질 개편 P0-4 - block-aware validation: a
                // [결론]/[확인사항]-tagged paragraph is allowed through
                // without a citation marker; an [근거]-tagged or untagged
                // paragraph still requires one, exactly as strictly as
                // before. ANY block containing a marker that does not
                // resolve to a real supplied citation is rejected
                // regardless of type. Only the tag-stripped text is ever
                // yielded to the client.
                const block = parseAnswerBlock(rawParagraph);
                assertAnswerBlockGrounded(block, synthesisCitations);
                groundedFullText += (groundedFullText.length > 0 ? "\n\n" : "") + block.text;
                chunksEmitted += 1;
                yield { type: "chunk", text: `${block.text}\n\n` };
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

        const trailingRaw = paragraphBuffer.trim();
        if (trailingRaw.length > 0) {
          const trailingBlock = parseAnswerBlock(trailingRaw);
          assertAnswerBlockGrounded(trailingBlock, synthesisCitations);
          groundedFullText += (groundedFullText.length > 0 ? "\n\n" : "") + trailingBlock.text;
          chunksEmitted += 1;
          yield { type: "chunk", text: trailingBlock.text };
        }
        streamStage = "completed";
      } finally {
        activeStreamingKeys.delete(cacheKey);
      }
    } catch (rawError) {
      // §Production Smoke 2026-09-08 finding - classifyAiStreamError()
      // replaces the previous blind normalizeProviderError(rawError) call:
      // that function had no way to recognize the citation-grounding
      // guard's OWN throws (a bare Error, by design - see
      // citation-required.ts) as anything other than an unrecognized
      // exception, so every grounding rejection silently collapsed to
      // PROVIDER_UNKNOWN - misreporting a correctly-working fail-closed
      // guard as a mysterious provider outage. classifyAiStreamError()
      // checks for AiGroundingError FIRST, before ever considering a
      // provider-shaped classification.
      const classified = classifyAiStreamError(rawError);
      const elapsedMs = Math.round(performance.now() - llmStart);
      // §Observability - safe, metadata-only: no question/prompt/contract
      // text, no answer text, no citation text, no secrets. Every field is
      // either a closed-vocabulary code, a class/type name, a boolean, a
      // count, or a duration.
      getLogger().warn("ai_stream.failed", {
        errorCode: classified.errorCode,
        originalErrorName: classified.originalErrorName,
        isProviderError: classified.isProviderError,
        httpStatus: classified.httpStatus,
        providerRequestId,
        streamStage,
        chunksEmitted,
        elapsedMs,
        providerName: llm.providerName,
        requestId: params.requestId,
      });
      await releaseAiBudget(reservation);
      await recordAiUsageBestEffort({
        organizationId: params.organizationId,
        userId: params.userId,
        conversationId: params.conversationId,
        operationType: AI_USAGE_OPERATION_TYPES.LLM_ASK_STREAM,
        provider: llm.providerName,
        model: llm.modelName,
        latencyMs: elapsedMs,
        success: false,
        errorCode: classified.errorCode,
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
    // §AI 답변 품질 개편 Phase 1.4.3 - `synthesisCitations`, matching
    // `messages` itself (built from the same set) - a shadow provider
    // response is validated against exactly what it was actually shown.
    maybeDispatchShadowEvaluation({ organizationId: params.organizationId, messages, contextCitations: synthesisCitations });

    yield {
      type: "done",
      fullText: groundedFullText,
      citations: filterCitationsToAnswerUsed(groundedFullText, synthesisCitations),
      canaryUsed: llmSelection.group === "canary",
    };
  } finally {
    recordAiRequestEnd();
  }
}
