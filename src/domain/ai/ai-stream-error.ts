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
 * §Grounding sub-reason telemetry (2026-09-09) - a closed vocabulary for
 * WHICH invariant inside citation-required.ts actually rejected an
 * answer, derived ONLY from the two throw sites reachable from the real
 * streaming per-block path (assertAnswerBlockGrounded, used exclusively
 * by askQuestionStreaming's for-await loop - see that function's own
 * docstring). The top-level AiUsageRecord.errorCode/client message stay
 * AI_GROUNDING_FAILED either way; this is additive, safe, enum-only
 * telemetry layered on top - never a new failure classification, never
 * anything client-visible.
 */
export const GROUNDING_REASONS = {
  /** A citation marker is present but does not match ANY supplied
   * citation (assertAnswerBlockGrounded's hasHallucinatedMarker check) -
   * the model referenced a clause/contract that was never in the
   * retrieved evidence set, or reproduced a marker's text inexactly. */
  UNKNOWN_CITATION_MARKER: "UNKNOWN_CITATION_MARKER",
  /** An evidence-type block (or a fail-safe-default untagged block)
   * contains zero valid citation markers at all - the model wrote an
   * evidentiary claim without attaching any source. */
  MISSING_REQUIRED_CITATION: "MISSING_REQUIRED_CITATION",
} as const;

export type GroundingReason = (typeof GROUNDING_REASONS)[keyof typeof GROUNDING_REASONS];

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
 *
 * `groundingReason` is OPTIONAL and deliberately narrow: only a throw
 * site whose invariant exactly matches one of GROUNDING_REASONS' two
 * values sets it. A throw site with no exact match (e.g. "zero
 * citations were supplied at all", "the assembled answer was empty") is
 * left undefined rather than forced into a misleading category - see
 * each call site in citation-required.ts for which case applies.
 */
export class AiGroundingError extends Error {
  readonly errorCode = AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED;
  readonly groundingReason?: GroundingReason;

  constructor(message: string, groundingReason?: GroundingReason) {
    super(message);
    this.name = "AiGroundingError";
    this.groundingReason = groundingReason;
  }
}

export interface ClassifiedAiStreamError {
  errorCode: AiStreamErrorCode | (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];
  isProviderError: boolean;
  httpStatus?: number;
  /** Safe to log - a class/type name only, never the exception's own message (which may echo generated text for a grounding rejection, or provider-supplied text for a raw provider exception). */
  originalErrorName: string;
  /** Only ever set when errorCode===AI_GROUNDING_FAILED and the throw site had an exact-match reason (see AiGroundingError's own docstring) - undefined for every other error, and undefined for a grounding rejection whose throw site had no exact-match reason. */
  groundingReason?: GroundingReason;
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
    return {
      errorCode: AI_STREAM_ERROR_CODES.AI_GROUNDING_FAILED,
      isProviderError: false,
      originalErrorName,
      groundingReason: rawError.groundingReason,
    };
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
