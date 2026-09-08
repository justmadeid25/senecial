import { describe, expect, it } from "vitest";

import {
  AI_STREAM_ERROR_CODES,
  AiGroundingError,
  classifyAiStreamError,
  safeAiStreamErrorMessage,
} from "@/domain/ai/ai-stream-error";
import { PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";

/**
 * §Production Smoke 2026-09-08 finding - before this fix, askQuestionStreaming's
 * outer catch ran EVERY exception (including citation-required.ts's own
 * grounding-guard throws) through normalizeProviderError(), which has no
 * way to recognize "this is our own validation code, not a provider" and
 * silently collapsed it to PROVIDER_UNKNOWN. These tests pin down
 * classifyAiStreamError()'s replacement behavior directly, as a pure
 * function, independent of the full streaming pipeline (see
 * tests/integration/ask-question-streaming-grounding.test.ts for the
 * end-to-end proof via a real AiUsageRecord write).
 */
describe("classifyAiStreamError (§Production Smoke 2026-09-08 finding)", () => {
  it("1. an AiGroundingError (as thrown by citation-required.ts on a hallucinated marker) classifies as AI_GROUNDING_FAILED", () => {
    const error = new AiGroundingError('citation 표시가 실제 제공된 근거와 일치하지 않아 출력을 거부합니다: "..."');
    const result = classifyAiStreamError(error);
    expect(result.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    expect(result.isProviderError).toBe(false);
  });

  it("2. an AiGroundingError (as thrown on an evidence paragraph with no valid marker) also classifies as AI_GROUNDING_FAILED", () => {
    const error = new AiGroundingError('citation 표시가 없는 근거 문단이 있어 출력을 거부합니다: "..."');
    const result = classifyAiStreamError(error);
    expect(result.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
  });

  it("3. a grounding failure never becomes PROVIDER_UNKNOWN, regardless of its message content", () => {
    // Even a message that happens to contain provider-sounding words must
    // never be reclassified - the check is by TYPE (instanceof
    // AiGroundingError), never by sniffing the message text.
    const error = new AiGroundingError("provider timeout unavailable rate limited - none of this text should matter");
    const result = classifyAiStreamError(error);
    expect(result.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    expect(result.errorCode).not.toBe(PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN);
  });

  it("4. a genuine ProviderError preserves its own errorCode and httpStatus unchanged", () => {
    const error = new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED, providerName: "openai", httpStatus: 429 });
    const result = classifyAiStreamError(error);
    expect(result.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED);
    expect(result.isProviderError).toBe(true);
    expect(result.httpStatus).toBe(429);
  });

  it("4b. every ProviderError code (not just one example) round-trips unchanged", () => {
    for (const code of Object.values(PROVIDER_ERROR_CODES)) {
      const error = new ProviderError({ errorCode: code, providerName: "openai" });
      expect(classifyAiStreamError(error).errorCode).toBe(code);
    }
  });

  it("5. a generic unexpected Error (not a ProviderError, not our grounding guard) classifies as AI_INTERNAL_ERROR - distinct from both a provider code and a grounding code", () => {
    const error = new TypeError("cannot read properties of undefined (simulated bug)");
    const result = classifyAiStreamError(error);
    expect(result.errorCode).toBe(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
    expect(result.isProviderError).toBe(false);
    expect(result.errorCode).not.toBe(PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN);
    expect(result.errorCode).not.toBe(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
  });

  it("a non-Error thrown value (e.g. a string or plain object) still classifies safely as AI_INTERNAL_ERROR, never throwing itself", () => {
    expect(classifyAiStreamError("a raw string throw").errorCode).toBe(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
    expect(classifyAiStreamError({ some: "object" }).errorCode).toBe(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
    expect(classifyAiStreamError(undefined).errorCode).toBe(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
  });

  it("existing AbortError semantics are preserved unchanged (§Goal 5 - do not regress an already-correct classification)", () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const result = classifyAiStreamError(abortError);
    expect(result.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_ABORTED);
    expect(result.isProviderError).toBe(true);
  });

  it("existing timeout-message heuristic is preserved unchanged for defense in depth", () => {
    const timeoutError = new Error("request timeout after 60000ms");
    const result = classifyAiStreamError(timeoutError);
    expect(result.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT);
    expect(result.isProviderError).toBe(true);
  });

  it("originalErrorName is always a safe class/type name, never the exception's own message", () => {
    const grounding = classifyAiStreamError(new AiGroundingError("some internal debug text with a citation snippet"));
    expect(grounding.originalErrorName).toBe("AiGroundingError");

    const bug = classifyAiStreamError(new TypeError("boom"));
    expect(bug.originalErrorName).toBe("TypeError");

    const nonError = classifyAiStreamError("plain string");
    expect(nonError.originalErrorName).toBe("string");
  });
});

describe("safeAiStreamErrorMessage (§Production Smoke 2026-09-08 finding - client-facing text)", () => {
  it("returns a fixed, non-outage-implying message for AI_GROUNDING_FAILED, distinct from the generic fallback", () => {
    const groundingMessage = safeAiStreamErrorMessage(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    const internalMessage = safeAiStreamErrorMessage(AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR);
    expect(groundingMessage).not.toBe(internalMessage);
    // Never implies a provider/infrastructure outage.
    expect(groundingMessage).not.toMatch(/공급자|provider|서버|일시적/);
  });

  it("never echoes internal exception detail - the message is a fixed constant, independent of any thrown error's own text", () => {
    const error = new AiGroundingError('citation 표시가 실제 제공된 근거와 일치하지 않아 출력을 거부합니다: "이것은 매우 민감한 답변 텍스트입니다"');
    const safeMessage = safeAiStreamErrorMessage(AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED);
    expect(safeMessage).not.toContain("민감한");
    expect(safeMessage).not.toBe(error.message);
  });
});
