import { PROVIDER_ERROR_CODES, ProviderError } from "./provider-error";

/**
 * §Production Smoke 2026-09-08 finding - closed vocabulary for WHY an AI
 * streaming answer failed to complete, DISTINCT from PROVIDER_ERROR_CODES
 * (provider-error.ts): those describe a real provider/network
 * communication failure; these describe OUR OWN application code
 * rejecting or failing to produce output. The two vocabularies must never
 * be conflated - see classifyAiStreamError() below, the single place that
 * decides which one applies to a given exception. Before this fix,
 * askQuestionStreaming's outer catch ran EVERY exception (including the
 * citation-grounding guard's own throws) through normalizeProviderError(),
 * which has no way to recognize "this is our own validation code, not a
 * provider" and silently collapsed it to PROVIDER_UNKNOWN - a correctly-
 * working fail-closed guard misreported as a mysterious provider outage.
 */
export const AI_STREAM_ERROR_CODES = {
  /** citation-required.ts's grounding guard rejected the generated answer
   * (a hallucinated citation marker, or an evidence block with no valid
   * marker at all) - the fail-closed guard working exactly as designed,
   * never a provider problem. */
  AI_GROUNDING_FAILED: "AI_GROUNDING_FAILED",
  /** Anything else unexpected inside the streaming pipeline that is
   * neither a ProviderError nor a grounding rejection - a real
   * application bug. Kept distinct from PROVIDER_UNKNOWN so an
   * application bug is never misattributed to the AI provider either. */
  AI_INTERNAL_ERROR: "AI_INTERNAL_ERROR",
} as const;

export type AiStreamErrorCode = (typeof AI_STREAM_ERROR_CODES)[keyof typeof AI_STREAM_ERROR_CODES];

/**
 * Fixed, safe user-facing/loggable text per code - never provider text,
 * and never the grounding guard's own internal debug message (which may
 * echo a short snippet of generated answer/citation text - fine for an
 * in-process exception a developer might inspect, never safe to log or
 * show to a user). Mirrors provider-error.ts's identical
 * SAFE_ERROR_MESSAGES pattern.
 */
const SAFE_AI_STREAM_ERROR_MESSAGES: Record<AiStreamErrorCode, string> = {
  AI_GROUNDING_FAILED: "근거를 충분히 확인하지 못해 답변을 완료하지 않았습니다. 다시 질문해 주세요.",
  AI_INTERNAL_ERROR: "답변을 생성하지 못했습니다. 다시 시도해 주세요.",
};

export function safeAiStreamErrorMessage(code: AiStreamErrorCode): string {
  return SAFE_AI_STREAM_ERROR_MESSAGES[code];
}

/**
 * The only Error subtype citation-required.ts's grounding guards
 * (assertEveryParagraphHasCitation / assertAnswerBlockGrounded /
 * assertAnswerGrounded) are allowed to throw. `.message` keeps carrying
 * the existing internal debug detail (may include a short snippet of
 * generated text) for in-process debugging ONLY - never log or expose it;
 * use safeAiStreamErrorMessage(AI_GROUNDING_FAILED) for anything
 * client-facing or logged.
 */
export class AiGroundingError extends Error {
  readonly errorCode = AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED;

  constructor(message: string) {
    super(message);
    this.name = "AiGroundingError";
  }
}

export interface ClassifiedAiStreamError {
  errorCode: AiStreamErrorCode | (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];
  isProviderError: boolean;
  httpStatus?: number;
  /** Safe to log - a class/type name only, never the exception's own message (which may echo generated text for a grounding rejection, or provider-supplied text for a raw provider exception). */
  originalErrorName: string;
}

/**
 * §Production Smoke 2026-09-08 finding - the single place askQuestionStreaming's
 * outer catch decides what actually failed, replacing a blind
 * normalizeProviderError(rawError) call that could not distinguish a real
 * provider failure from the app's own validation code throwing. Every
 * exception that can legitimately originate from llm.stream() itself is
 * ALREADY a ProviderError instance by the time it reaches here - every
 * real LlmProvider implementation wraps its own network/parsing failures
 * before letting them escape (see e.g. openai-responses-llm-provider.ts's
 * own catch-all, which maps any raw stream-reading failure to
 * PROVIDER_ABORTED before it ever leaves the generator). So this
 * function's job is narrow: recognize our own AiGroundingError FIRST
 * (never let it fall through to a provider code), preserve a real
 * ProviderError's own code unchanged, keep the existing
 * AbortError/timeout-message recognition for defense in depth, and only
 * reach for a generic "internal" classification (never "provider") for
 * anything else unrecognized.
 */
export function classifyAiStreamError(rawError: unknown): ClassifiedAiStreamError {
  const originalErrorName = rawError instanceof Error ? rawError.name : typeof rawError;

  if (rawError instanceof AiGroundingError) {
    return { errorCode: AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED, isProviderError: false, originalErrorName };
  }
  if (rawError instanceof ProviderError) {
    return { errorCode: rawError.errorCode, isProviderError: true, httpStatus: rawError.httpStatus, originalErrorName };
  }
  if (rawError instanceof Error && rawError.name === "AbortError") {
    return { errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, isProviderError: true, originalErrorName };
  }
  if (rawError instanceof Error && /timeout/i.test(rawError.message)) {
    return { errorCode: PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT, isProviderError: true, originalErrorName };
  }
  return { errorCode: AI_STREAM_ERROR_CODES.AI_INTERNAL_ERROR, isProviderError: false, originalErrorName };
}
