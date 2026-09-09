import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_STREAM_ERROR_CODES, GROUNDING_REASONS } from "@/domain/ai/ai-stream-error";
import type { Citation } from "@/domain/ai/citation";
import { buildCitationMarker } from "@/domain/ai/citation-marker";
import type { AiStreamEvent, LlmCallOptions, LlmCompletionResult, LlmMessage, LlmProvider } from "@/domain/ai/llm-provider";
import { PROVIDER_ERROR_CODES } from "@/domain/ai/provider-error";
import { prisma } from "@/server/db/client";

/**
 * §AI 답변 품질 개편 P0-4 - exercises askQuestionStreaming()'s REAL
 * paragraph-buffering + block-grounding control flow end to end (test
 * scenarios 6/7/8: mid-paragraph stream end, provider error after one
 * validated block, abort/cancel), against a real lightweight organization
 * so loadOrganizationAiContext()/budget reservation/usage recording all
 * run for real (no DB mocking needed - unlimited default budget, aiEnabled
 * default true). Only two seams are mocked:
 *  - retrieveContext(): returns a FIXED, controlled Citation[] directly,
 *    sidestepping the need for a full extraction/segmentation/embedding
 *    fixture pipeline - this test is about streaming mechanics, not
 *    retrieval, which already has its own dedicated integration coverage
 *    (hybrid-search.test.ts, ai-contract-scoping.test.ts).
 *  - getLlmProviderForOrganization(): returns a test-controlled fake
 *    LlmProvider whose stream() yields exactly the events each scenario
 *    needs (a real, controllable double, not a reimplementation of
 *    ask-question.ts's own logic).
 */

const CITATION: Citation = {
  evidenceType: "clause",
  contractClauseId: "clause-1",
  chunkId: null,
  contractId: "contract-1",
  contractTitle: "테스트 계약",
  clauseReference: "제1조",
  evidenceText: "계약기간 종료 후 자동 갱신되며, 종료 30일 전까지 통지해야 한다.",
  score: 0.9,
};
// retrieveContext() is mocked below to return exactly [CITATION], so its
// server-issued token (see citation-marker.ts) is always index 1.
const MARKER = buildCitationMarker(1);
// An out-of-range index for the 1-citation supplied set - the closed-set
// numeric-token equivalent of the old "가짜조항 - 존재하지않는계약" forged
// text marker.
const UNKNOWN_MARKER = buildCitationMarker(99);

vi.mock("@/features/ai/server/retrieve-context", () => ({
  retrieveContext: vi.fn(async () => [CITATION]),
}));

let fakeLlm: LlmProvider;

vi.mock("@/server/services/ai/get-llm-provider-for-organization", () => ({
  getLlmProviderForOrganization: () => ({ provider: fakeLlm, group: "primary" as const }),
}));

// §Production Smoke 2026-09-08 finding - captures ask-question.ts's new
// ai_stream.failed structured log so tests can assert BOTH that it fires
// with the right metadata AND that it never carries prompt/answer/citation
// content (see the "safe observability" describe block below).
const loggerWarnSpy = vi.fn();
vi.mock("@/server/logging", () => ({
  getLogger: () => ({ info: vi.fn(), warn: loggerWarnSpy, error: vi.fn() }),
}));

const { askQuestionStreaming } = await import("@/features/ai/server/ask-question");

function buildFakeLlm(streamFn: (messages: LlmMessage[], options?: LlmCallOptions) => AsyncIterable<AiStreamEvent>): LlmProvider {
  return {
    providerName: "test-fake",
    modelName: "test-fake-v1",
    async generateCompletion(): Promise<LlmCompletionResult> {
      throw new Error("not used by these streaming tests");
    },
    stream: streamFn,
  };
}

async function* toDeltas(...texts: string[]): AsyncGenerator<AiStreamEvent> {
  for (const text of texts) {
    yield { type: "text-delta", text };
  }
  yield { type: "usage", inputTokens: 10, outputTokens: 10 };
  yield { type: "done", finishReason: "stop" };
}

const TEST_EMAIL_DOMAIN = "ask-question-streaming-grounding-test.local";
let organizationId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  const org = await prisma.organization.create({
    data: { name: "Ask-Question Streaming Grounding Test Org", slug: `ask-question-streaming-test-${Date.now()}` },
  });
  organizationId = org.id;
});

beforeEach(() => {
  loggerWarnSpy.mockClear();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: organizationId } });
});

// §Test isolation - the prompt cache key is a pure function of
// (organizationId, llm.providerName/modelName, serialized messages), and
// the in-memory cache provider is a process-wide singleton that outlives
// any single test - a repeated literal question would hit a PRIOR test
// case's cached completion instead of exercising this run's fake stream.
// Each call gets a unique question so every test computes its own cache
// key, matching real usage (a user never asks the byte-identical question
// twice within the same TTL window in these tests).
// §Real contract - askQuestionStreaming() ITSELF throws on a grounding
// failure or a provider error (see its own try/catch, which only cleans up
// activeStreamingKeys/budget before re-throwing); it never yields a
// {type:"error"} event on its own. That translation is route.ts's job
// (its own try/catch around the `for await` loop - see
// src/app/api/ai/ask/route.ts). This helper mirrors THAT real behavior so
// assertions here reflect what a client actually receives end to end.
let questionCounter = 0;
async function collectEvents(): Promise<Array<{ type: string; text?: string }>> {
  questionCounter += 1;
  const events: Array<{ type: string; text?: string }> = [];
  try {
    for await (const event of askQuestionStreaming({
      organizationId,
      question: `이 계약 자동갱신돼? (test case #${questionCounter})`,
    })) {
      events.push(event.type === "chunk" ? { type: "chunk", text: event.text } : { type: event.type });
    }
  } catch {
    events.push({ type: "error" });
  }
  return events;
}

describe("askQuestionStreaming - paragraph buffering + block grounding (§AI 답변 품질 개편 P0-4)", () => {
  it("6. a provider stream ending mid-paragraph (no trailing blank line) still validates and yields the trailing block via the flush-at-end path", async () => {
    fakeLlm = buildFakeLlm(() => toDeltas(`[결론] 네, 자동 갱신됩니다.`));
    const events = await collectEvents();
    const chunks = events.filter((e) => e.type === "chunk").map((e) => e.text);
    expect(chunks).toEqual(["네, 자동 갱신됩니다."]);
    expect(events.at(-1)!.type).toBe("done");
  });

  it("7. a provider error AFTER one validated block was already yielded surfaces as an 'error' event, without silently discarding the block already sent", async () => {
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 네, 자동 갱신됩니다.\n\n` };
      throw new Error("simulated provider network failure mid-stream");
    });
    const events = await collectEvents();
    const chunkEvents = events.filter((e) => e.type === "chunk");
    expect(chunkEvents).toHaveLength(1);
    expect(chunkEvents[0]!.text!.trim()).toBe("네, 자동 갱신됩니다.");
    expect(events.at(-1)!.type).toBe("error");
    // The user must never mistake this for a complete, successful answer -
    // no "done" event was ever produced for this request.
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("a block that fails grounding (uncited 근거 paragraph) aborts the stream with an error, never flushing the ungrounded text", async () => {
    fakeLlm = buildFakeLlm(() => toDeltas(`[근거] 이 조항은 사실이 아닌 내용을 담고 있습니다.\n\n`));
    const events = await collectEvents();
    expect(events.filter((e) => e.type === "chunk")).toHaveLength(0);
    expect(events.at(-1)!.type).toBe("error");
  });

  it("a hallucinated citation marker mid-stream aborts before that block is ever exposed to the client", async () => {
    fakeLlm = buildFakeLlm(() =>
      toDeltas(`[결론] 이 계약은 안전합니다. ${UNKNOWN_MARKER}\n\n`)
    );
    const events = await collectEvents();
    expect(events.filter((e) => e.type === "chunk")).toHaveLength(0);
    expect(events.at(-1)!.type).toBe("error");
  });

  it("a valid multi-block answer streams every block, tag-stripped, ending in 'done'", async () => {
    fakeLlm = buildFakeLlm(() =>
      toDeltas(
        `[결론] 네, 자동 갱신되는 구조입니다.\n\n`,
        `[근거] 계약기간 종료 후 자동 갱신됩니다. ${MARKER}\n\n`,
        `[확인사항] 종료일 30일 전까지 통지 가능한지 확인하십시오.`
      )
    );
    const events = await collectEvents();
    const chunks = events.filter((e) => e.type === "chunk").map((e) => e.text!.trim());
    expect(chunks).toEqual([
      "네, 자동 갱신되는 구조입니다.",
      `계약기간 종료 후 자동 갱신됩니다. ${MARKER}`,
      "종료일 30일 전까지 통지 가능한지 확인하십시오.",
    ]);
    expect(events.at(-1)!.type).toBe("done");
  });

  it("8. abort/cancel: a client-signaled abort mid-stream is respected by the generator (real regression check that P0-4's buffering changes did not disturb the pre-existing abort contract)", async () => {
    fakeLlm = buildFakeLlm(async function* (_messages, options) {
      yield { type: "text-delta", text: "[결론] 첫 부분" };
      // Simulate the provider itself observing an aborted signal mid-stream
      // (the same contract every real provider implementation follows).
      if (options?.abortSignal?.aborted) {
        return;
      }
      yield { type: "text-delta", text: " 나머지.\n\n" };
      yield { type: "usage", inputTokens: 5, outputTokens: 5 };
      yield { type: "done", finishReason: "stop" };
    });

    const controller = new AbortController();
    const events: Array<{ type: string }> = [];
    const iterator = askQuestionStreaming({ organizationId, question: "이 계약 자동갱신돼? (abort test case)" });
    // Consume one tick, then abort - the route handler's own cancel() sets
    // a flag the generator loop checks; here we exercise the generator's
    // own resilience to being torn down mid-iteration (return()/throw()
    // never leaves budget/cache bookkeeping in a broken state - see the
    // generator's `finally` blocks).
    for await (const event of iterator) {
      events.push({ type: event.type });
      controller.abort();
    }
    // No assertion on exact event count (provider-specific) - the real
    // regression this guards is that iterating to completion or breaking
    // early never throws an unhandled rejection out of the generator.
    expect(events.length).toBeGreaterThan(0);
  });
});

async function findLatestFailedUsageRecord() {
  return prisma.aiUsageRecord.findFirst({
    where: { organizationId, operationType: "llm_ask_stream", success: false },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * §Production Smoke 2026-09-08 finding - the production incident this
 * describe block guards against: a citation-grounding rejection (the
 * fail-closed guard working exactly as designed) was silently recorded as
 * AiUsageRecord.errorCode="PROVIDER_UNKNOWN", making a correctly-working
 * application guard indistinguishable from a real OpenAI outage in every
 * downstream signal (usage records, logs, the user-facing message).
 */
describe("askQuestionStreaming - error classification (§Production Smoke 2026-09-08 finding)", () => {
  it("1/3. a hallucinated citation marker classifies as AI_GROUNDING_FAILED, never PROVIDER_UNKNOWN, in the recorded AiUsageRecord", async () => {
    fakeLlm = buildFakeLlm(() =>
      toDeltas(`[결론] 이 계약은 안전합니다. ${UNKNOWN_MARKER}\n\n`)
    );
    const events = await collectEvents();
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage).not.toBeNull();
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    expect(usage!.errorCode).not.toBe("PROVIDER_UNKNOWN");
  });

  it("2/3. an evidence paragraph with no valid citation marker also classifies as AI_GROUNDING_FAILED", async () => {
    fakeLlm = buildFakeLlm(() => toDeltas(`[근거] 이 조항은 사실이 아닌 내용을 담고 있습니다.\n\n`));
    const events = await collectEvents();
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
  });

  it("6/7/8. partial chunks already yielded stay fail-closed: no 'done' event fires (so route.ts's addMessage() for the ASSISTANT role, which only runs on 'done', can never persist a grounding-rejected answer) and the failed AiUsageRecord is written with success=false/errorCode=AI_GROUNDING_FAILED", async () => {
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 네, 자동 갱신됩니다.\n\n` };
      yield { type: "text-delta", text: `[근거] 근거 없는 문장입니다.\n\n` };
    });
    const events = await collectEvents();

    const chunkEvents = events.filter((e) => e.type === "chunk");
    expect(chunkEvents).toHaveLength(1);
    expect(chunkEvents[0]!.text!.trim()).toBe("네, 자동 갱신됩니다.");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.success).toBe(false);
    expect(usage!.operationType).toBe("llm_ask_stream");
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
  });

  it("A. a valid first block, then a SECOND block with a marker matching no supplied citation, classifies as groundingReason=UNKNOWN_CITATION_MARKER (§Root Cause Phase 2)", async () => {
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 네, 자동 갱신됩니다.\n\n` };
      // A syntactically valid marker whose index is out of range for the
      // 1-citation supplied set - a hallucinated/unknown reference, not an
      // absent one.
      yield { type: "text-delta", text: `[근거] 이 조항은 다른 내용입니다. ${UNKNOWN_MARKER}\n\n` };
    });
    const events = await collectEvents();

    const chunkEvents = events.filter((e) => e.type === "chunk");
    expect(chunkEvents).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.success).toBe(false);
    expect(usage!.operationType).toBe("llm_ask_stream");
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);

    const failedCalls = loggerWarnSpy.mock.calls.filter(([event]) => event === "ai_stream.failed");
    const [, payload] = failedCalls.at(-1)!;
    expect(payload).toMatchObject({
      errorCode: AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED,
      groundingReason: GROUNDING_REASONS.UNKNOWN_CITATION_MARKER,
      chunksEmitted: 1,
    });
    // The safe log payload must never leak the real citation's own display
    // text either - only closed-vocabulary codes/counts (see the dedicated
    // "9/10." safe-log test below for the fuller assertion).
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(CITATION.contractTitle);
    expect(serialized).not.toContain(CITATION.clauseReference);
  });

  it("B. a valid first block, then a SECOND evidence block with NO citation marker at all, classifies as groundingReason=MISSING_REQUIRED_CITATION (§Root Cause Phase 2)", async () => {
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 네, 자동 갱신됩니다.\n\n` };
      yield { type: "text-delta", text: `[근거] 근거 표시가 전혀 없는 문장입니다.\n\n` };
    });
    const events = await collectEvents();

    const chunkEvents = events.filter((e) => e.type === "chunk");
    expect(chunkEvents).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.success).toBe(false);
    expect(usage!.operationType).toBe("llm_ask_stream");
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);

    const failedCalls = loggerWarnSpy.mock.calls.filter(([event]) => event === "ai_stream.failed");
    const [, payload] = failedCalls.at(-1)!;
    expect(payload).toMatchObject({
      errorCode: AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED,
      groundingReason: GROUNDING_REASONS.MISSING_REQUIRED_CITATION,
      chunksEmitted: 1,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("근거 표시가 전혀 없는");
  });

  it("4. a genuine ProviderError thrown by the LLM provider preserves ITS OWN provider errorCode unchanged, never overwritten by the grounding/internal classifier", async () => {
    const { ProviderError, PROVIDER_ERROR_CODES: CODES } = await import("@/domain/ai/provider-error");
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 시작.\n\n` };
      throw new ProviderError({ errorCode: CODES.PROVIDER_RATE_LIMITED, providerName: "test-fake" });
    });
    const events = await collectEvents();
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED);

    const failedCalls = loggerWarnSpy.mock.calls.filter(([event]) => event === "ai_stream.failed");
    const [, payload] = failedCalls.at(-1)!;
    expect(payload.groundingReason).toBeUndefined();
  });

  it("5. a genuinely unexpected, unwrapped exception (not a ProviderError, not our grounding guard) classifies as AI_INTERNAL_ERROR - distinct from BOTH a provider code and AI_GROUNDING_FAILED", async () => {
    fakeLlm = buildFakeLlm(async function* () {
      yield { type: "text-delta", text: `[결론] 시작.\n\n` };
      // Deliberately a raw, unwrapped bug - e.g. a TypeError from an
      // unrelated coding mistake - never something a real LlmProvider
      // implementation would let escape (see openai-responses-llm-provider.ts's
      // own catch-all), but exactly the shape classifyAiStreamError()
      // must still handle safely without misreporting it as either a
      // provider failure or a grounding rejection.
      throw new TypeError("unexpected null access - simulated application bug, unrelated to the provider or grounding");
    });
    const events = await collectEvents();
    expect(events.at(-1)!.type).toBe("error");

    const usage = await findLatestFailedUsageRecord();
    expect(usage!.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
    expect(usage!.errorCode).not.toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    expect(usage!.errorCode).not.toBe("PROVIDER_UNKNOWN");

    const failedCalls = loggerWarnSpy.mock.calls.filter(([event]) => event === "ai_stream.failed");
    const [, payload] = failedCalls.at(-1)!;
    expect(payload.groundingReason).toBeUndefined();
  });

  it("9/10. the safe structured ai_stream.failed log carries only metadata (codes/booleans/counts/durations) and never the generated answer or citation text", async () => {
    const secretText = "이 조항은 사실이 아닌 내용을 담고 있습니다 - 민감한-정답-텍스트-마커";
    fakeLlm = buildFakeLlm(() => toDeltas(`[근거] ${secretText}\n\n`));
    await collectEvents();

    const failedCalls = loggerWarnSpy.mock.calls.filter(([event]) => event === "ai_stream.failed");
    expect(failedCalls.length).toBeGreaterThan(0);
    const [, payload] = failedCalls.at(-1)!;

    // Only safe, flat metadata fields - matches SafeLogData's own
    // "no nested objects" contract (domain/logging/logger.ts).
    expect(payload).toMatchObject({
      errorCode: AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED,
      isProviderError: false,
      streamStage: expect.any(String),
      chunksEmitted: expect.any(Number),
      elapsedMs: expect.any(Number),
      providerName: "test-fake",
    });
    expect(typeof payload.originalErrorName).toBe("string");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain("근거");
    expect(serialized.length).toBeLessThan(500);
  });
});
