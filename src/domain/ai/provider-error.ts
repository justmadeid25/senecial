/**
 * §Phase 13 Part E (§15) - closed vocabulary for every AI provider
 * (embedding/LLM) communication failure, mirroring
 * domain/ai/embedding-error-codes.ts's "safe, closed vocabulary" pattern
 * and domain/email/mail-error-codes.ts's classify-then-store-only-the-code
 * shape. Never store/log a raw provider exception message, request body,
 * or response body anywhere this code touches - only these codes, plus a
 * FIXED Korean message per code (never provider-supplied text).
 */
export const PROVIDER_ERROR_CODES = {
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  PROVIDER_INVALID_REQUEST: "PROVIDER_INVALID_REQUEST",
  PROVIDER_CONTENT_BLOCKED: "PROVIDER_CONTENT_BLOCKED",
  PROVIDER_CONTEXT_TOO_LARGE: "PROVIDER_CONTEXT_TOO_LARGE",
  PROVIDER_RESPONSE_INVALID: "PROVIDER_RESPONSE_INVALID",
  PROVIDER_ABORTED: "PROVIDER_ABORTED",
  PROVIDER_UNKNOWN: "PROVIDER_UNKNOWN",
} as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];

/**
 * §16 - retry-eligible codes only: transient/infrastructure failures where
 * a second attempt has a real chance of succeeding. Auth failures, invalid
 * requests, content-blocked, context-too-large, and user aborts are NEVER
 * retryable - retrying them either cannot succeed (the request itself is
 * the problem) or actively violates user intent (an abort).
 */
export function isRetryableProviderErrorCode(code: ProviderErrorCode): boolean {
  switch (code) {
    case PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT:
    case PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED:
    case PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE:
      return true;
    default:
      return false;
  }
}

/**
 * §17/§18 - a NARROWER set than isRetryableProviderErrorCode(): fallback to
 * a secondary provider is only appropriate for infrastructure-shaped
 * failures (timeout/rate-limit/unavailable) or an OPEN circuit breaker
 * (PROVIDER_UNAVAILABLE is also what beforeCall() reports for that case -
 * see get-ai-circuit-breaker.ts). Never fallback on abort, invalid
 * request, content policy, or context-too-large - §18's explicit "금지
 * 후보" list.
 */
export function isFallbackEligibleProviderErrorCode(code: ProviderErrorCode): boolean {
  switch (code) {
    case PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT:
    case PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED:
    case PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE:
      return true;
    default:
      return false;
  }
}

const SAFE_ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  PROVIDER_TIMEOUT: "AI 공급자 요청이 시간 초과되었습니다.",
  PROVIDER_RATE_LIMITED: "AI 공급자 요청 한도에 도달했습니다.",
  PROVIDER_UNAVAILABLE: "AI 공급자를 일시적으로 사용할 수 없습니다.",
  PROVIDER_AUTH_FAILED: "AI 공급자 인증에 실패했습니다.",
  PROVIDER_INVALID_REQUEST: "AI 공급자가 요청을 거부했습니다.",
  PROVIDER_CONTENT_BLOCKED: "AI 공급자의 콘텐츠 정책에 의해 차단되었습니다.",
  PROVIDER_CONTEXT_TOO_LARGE: "요청이 AI 공급자의 컨텍스트 한도를 초과했습니다.",
  PROVIDER_RESPONSE_INVALID: "AI 공급자 응답 형식이 올바르지 않습니다.",
  PROVIDER_ABORTED: "요청이 취소되었습니다.",
  PROVIDER_UNKNOWN: "AI 공급자 요청 중 알 수 없는 오류가 발생했습니다.",
};

/**
 * The only Error subtype any AI provider class (embedding or LLM) is
 * allowed to throw. `cause` may carry the raw underlying error for
 * IN-PROCESS debugging only (e.g. a stack trace visible in a local
 * exception) - it must never be passed to AppLogger (whose SafeLogData
 * type structurally rejects nested objects anyway) or persisted to
 * EmbeddingJob.errorMessage / AiUsageRecord / any other stored column.
 */
export class ProviderError extends Error {
  readonly errorCode: ProviderErrorCode;
  readonly providerName: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(params: { errorCode: ProviderErrorCode; providerName: string; httpStatus?: number; cause?: unknown }) {
    super(SAFE_ERROR_MESSAGES[params.errorCode]);
    this.name = "ProviderError";
    this.errorCode = params.errorCode;
    this.providerName = params.providerName;
    this.httpStatus = params.httpStatus;
    this.retryable = isRetryableProviderErrorCode(params.errorCode);
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }
}

/**
 * §15 - maps an HTTP status code alone (never the response body - a body
 * may contain account/billing details or echo request content) to a
 * closed-vocabulary code. 413 is treated as context-too-large (the most
 * common real-world cause of a provider rejecting an oversized payload);
 * a provider whose actual semantics differ can still layer its own
 * status-specific overrides on top of this before falling through.
 */
export function classifyProviderHttpStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED;
  if (status === 429) return PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED;
  if (status === 413) return PROVIDER_ERROR_CODES.PROVIDER_CONTEXT_TOO_LARGE;
  if (status === 408) return PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT;
  if (status === 400 || status === 404 || status === 422) return PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST;
  if (status === 502 || status === 503 || status === 504) return PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE;
  if (status >= 500) return PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE;
  return PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN;
}

/**
 * Normalizes ANY thrown value (a fetch network error, an AbortError, an
 * already-classified ProviderError, or something unexpected) into a
 * ProviderError - the single point every provider/orchestrator can rely on
 * to never see a raw, unclassified exception. Mirrors
 * classifyMailSendError()'s role for the mail subsystem.
 */
export function normalizeProviderError(params: { error: unknown; providerName: string }): ProviderError {
  const { error, providerName } = params;
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, providerName, cause: error });
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT, providerName, cause: error });
  }
  return new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN, providerName, cause: error });
}
