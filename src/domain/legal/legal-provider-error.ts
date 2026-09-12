/**
 * §Phase L1 §10 - closed vocabulary for every 국가법령정보 공동활용 (Law Open
 * Data) provider communication failure, mirroring
 * domain/ai/provider-error.ts's identical "classify-then-store-only-the-code"
 * shape. Never store/log a raw upstream response body, request URL query
 * string (which carries the OC credential), or exception message anywhere
 * this code touches - only these codes, plus a FIXED Korean message per
 * code (never provider-supplied text).
 *
 * Kept as its own parallel module (not a reuse of domain/ai/provider-error.ts)
 * because the Law Open Data API is a distinct external system with its own
 * failure shape (e.g. LEGAL_SOURCE_NOT_FOUND / LEGAL_SOURCE_UNVERIFIED have
 * no AI-provider equivalent) - see AGENTS.md's "smallest integration
 * surface" instruction: this never touches the existing AI provider error
 * vocabulary or its call sites.
 */
export const LEGAL_PROVIDER_ERROR_CODES = {
  LEGAL_PROVIDER_AUTH_FAILED: "LEGAL_PROVIDER_AUTH_FAILED",
  LEGAL_PROVIDER_TIMEOUT: "LEGAL_PROVIDER_TIMEOUT",
  LEGAL_PROVIDER_RATE_LIMITED: "LEGAL_PROVIDER_RATE_LIMITED",
  LEGAL_PROVIDER_UNAVAILABLE: "LEGAL_PROVIDER_UNAVAILABLE",
  LEGAL_PROVIDER_INVALID_REQUEST: "LEGAL_PROVIDER_INVALID_REQUEST",
  LEGAL_PROVIDER_MALFORMED_RESPONSE: "LEGAL_PROVIDER_MALFORMED_RESPONSE",
  LEGAL_PROVIDER_ABORTED: "LEGAL_PROVIDER_ABORTED",
  LEGAL_PROVIDER_UNKNOWN: "LEGAL_PROVIDER_UNKNOWN",
  LEGAL_SOURCE_NOT_FOUND: "LEGAL_SOURCE_NOT_FOUND",
  LEGAL_SOURCE_UNVERIFIED: "LEGAL_SOURCE_UNVERIFIED",
} as const;

export type LegalProviderErrorCode = (typeof LEGAL_PROVIDER_ERROR_CODES)[keyof typeof LEGAL_PROVIDER_ERROR_CODES];

/**
 * Retry-eligible codes only - transient/infrastructure failures where a
 * second attempt has a real chance of succeeding. Auth failures, invalid
 * requests, malformed responses, not-found, unverified, and aborts are
 * NEVER retryable - matches domain/ai/provider-error.ts's identical
 * rationale for isRetryableProviderErrorCode().
 */
export function isRetryableLegalProviderErrorCode(code: LegalProviderErrorCode): boolean {
  switch (code) {
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT:
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_RATE_LIMITED:
    case LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE:
      return true;
    default:
      return false;
  }
}

const SAFE_ERROR_MESSAGES: Record<LegalProviderErrorCode, string> = {
  LEGAL_PROVIDER_AUTH_FAILED: "국가법령정보 공동활용 API 인증에 실패했습니다.",
  LEGAL_PROVIDER_TIMEOUT: "국가법령정보 공동활용 API 요청이 시간 초과되었습니다.",
  LEGAL_PROVIDER_RATE_LIMITED: "국가법령정보 공동활용 API 요청 한도에 도달했습니다.",
  LEGAL_PROVIDER_UNAVAILABLE: "국가법령정보 공동활용 API를 일시적으로 사용할 수 없습니다.",
  LEGAL_PROVIDER_INVALID_REQUEST: "국가법령정보 공동활용 API가 요청을 거부했습니다.",
  LEGAL_PROVIDER_MALFORMED_RESPONSE: "국가법령정보 공동활용 API 응답 형식이 올바르지 않습니다.",
  LEGAL_PROVIDER_ABORTED: "요청이 취소되었습니다.",
  LEGAL_PROVIDER_UNKNOWN: "국가법령정보 공동활용 API 요청 중 알 수 없는 오류가 발생했습니다.",
  LEGAL_SOURCE_NOT_FOUND: "요청한 법령/판례를 찾을 수 없습니다.",
  LEGAL_SOURCE_UNVERIFIED: "이 법령정보 출처는 아직 검증되지 않아 신뢰 가능한 근거로 사용할 수 없습니다.",
};

/**
 * The only Error subtype any Law Open Data provider class is allowed to
 * throw. `cause` may carry the raw underlying error for IN-PROCESS
 * debugging only - it must never be passed to AppLogger or persisted to any
 * stored column, mirroring domain/ai/provider-error.ts's ProviderError.
 */
export class LegalProviderError extends Error {
  readonly errorCode: LegalProviderErrorCode;
  readonly providerName: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(params: { errorCode: LegalProviderErrorCode; providerName: string; httpStatus?: number; cause?: unknown }) {
    super(SAFE_ERROR_MESSAGES[params.errorCode]);
    this.name = "LegalProviderError";
    this.errorCode = params.errorCode;
    this.providerName = params.providerName;
    this.httpStatus = params.httpStatus;
    this.retryable = isRetryableLegalProviderErrorCode(params.errorCode);
    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }
}

/**
 * Maps an HTTP status code alone (never the response body) to a
 * closed-vocabulary code - mirrors domain/ai/provider-error.ts's
 * classifyProviderHttpStatus(). The Law Open Data API reports its own
 * request-level errors inside a 200 response body (see
 * law-open-data-types.ts's `resultCode`) rather than via HTTP status in
 * most cases, so this only covers genuine transport/HTTP-layer failures.
 */
export function classifyLegalProviderHttpStatus(status: number): LegalProviderErrorCode {
  if (status === 401 || status === 403) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_AUTH_FAILED;
  if (status === 429) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_RATE_LIMITED;
  if (status === 408) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT;
  if (status === 400 || status === 404 || status === 422) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST;
  if (status === 502 || status === 503 || status === 504) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE;
  if (status >= 500) return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE;
  return LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNKNOWN;
}

/**
 * Normalizes ANY thrown value into a LegalProviderError - the single point
 * every provider call site can rely on to never see a raw, unclassified
 * exception. Mirrors domain/ai/provider-error.ts's normalizeProviderError().
 */
export function normalizeLegalProviderError(params: { error: unknown; providerName: string }): LegalProviderError {
  const { error, providerName } = params;
  if (error instanceof LegalProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_ABORTED, providerName, cause: error });
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT, providerName, cause: error });
  }
  return new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNKNOWN, providerName, cause: error });
}
