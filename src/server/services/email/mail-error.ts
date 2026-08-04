import { MAIL_ERROR_CODES, type MailErrorCode } from "@/domain/email/mail-error-codes";

export interface PostmarkErrorBody {
  ErrorCode?: number;
  Message?: string;
}

/**
 * Phase 10B section 16 - the ONLY place allowed to look at a raw Postmark
 * HTTP status/response body. Translates it into one of the app's own safe
 * error codes; the raw `Message` (which can echo back request details) is
 * never returned from here and must never be logged or stored - see
 * mail-delivery-repository.ts, which only ever receives this function's
 * return value.
 *
 * Postmark's own ErrorCode taxonomy (subset relevant here):
 *  - 300: invalid email request (bad recipient format etc.)
 *  - 400: sender signature not found / not confirmed
 *  - 406: inactive recipient (previously bounced/complained)
 *  - 401 (HTTP status, not a JSON ErrorCode): invalid server token
 * Anything else, or a network/timeout failure with no HTTP response at
 * all, is treated as a transient provider issue (retryable).
 */
export function classifyPostmarkError(params: {
  httpStatus?: number;
  body?: PostmarkErrorBody;
  isTimeout?: boolean;
}): MailErrorCode {
  if (params.isTimeout) {
    return MAIL_ERROR_CODES.PROVIDER_TIMEOUT;
  }

  if (params.httpStatus === 401) {
    return MAIL_ERROR_CODES.PROVIDER_AUTH_FAILED;
  }
  if (params.httpStatus === 429) {
    return MAIL_ERROR_CODES.PROVIDER_RATE_LIMITED;
  }
  if (params.httpStatus !== undefined && params.httpStatus >= 500) {
    return MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE;
  }

  const errorCode = params.body?.ErrorCode;
  if (errorCode === 300 || errorCode === 406) {
    return MAIL_ERROR_CODES.INVALID_RECIPIENT;
  }
  if (errorCode === 400) {
    return MAIL_ERROR_CODES.SENDER_NOT_VERIFIED;
  }

  return MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE;
}

/** Caps length and strips newlines so a downstream `errorMessage` column/log line can never smuggle in a multi-line provider payload dump - defense in depth, callers should already be passing only the safe code's own fixed description. */
export function toSafeMailErrorMessage(errorCode: MailErrorCode): string {
  const messages: Record<MailErrorCode, string> = {
    PROVIDER_TIMEOUT: "이메일 제공자 응답 시간 초과",
    PROVIDER_RATE_LIMITED: "이메일 제공자 rate limit 초과",
    PROVIDER_UNAVAILABLE: "이메일 제공자를 일시적으로 사용할 수 없음",
    INVALID_RECIPIENT: "수신 주소가 유효하지 않음",
    SENDER_NOT_VERIFIED: "발신 주소가 제공자에 등록/확인되지 않음",
    PROVIDER_AUTH_FAILED: "이메일 제공자 인증 실패",
    MAX_ATTEMPTS_REACHED: "최대 재시도 횟수 초과",
    TOKEN_REISSUE_REQUIRED: "토큰 재발급 필요 (정체된 토큰 메일)",
  };
  return messages[errorCode];
}
