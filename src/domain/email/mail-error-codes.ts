/**
 * Phase 10B section 16 - the only vocabulary ever written to
 * `MailDelivery.errorCode` or logged for a send failure. Never the
 * provider's raw error message, HTTP body, or an API key/Authorization
 * header value - see server/services/email's error-mapping module, which
 * is the only place allowed to look at a raw provider error and must
 * translate it into one of these before it goes anywhere else.
 */
export const MAIL_ERROR_CODES = {
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_RECIPIENT: "INVALID_RECIPIENT",
  SENDER_NOT_VERIFIED: "SENDER_NOT_VERIFIED",
  PROVIDER_AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  /**
   * Phase 10C - written to a stale, still-PENDING token-bearing MailDelivery
   * row (see domain/email/token-mail-types.ts) when it is CANCELLED by
   * scan/recover-stale-token-deliveries. Never retried - the original
   * plaintext token is gone; the only way forward is a brand new token
   * (rotated) or, for PASSWORD_RESET, a fresh user-initiated request.
   */
  TOKEN_REISSUE_REQUIRED: "TOKEN_REISSUE_REQUIRED",
} as const;

export type MailErrorCode = (typeof MAIL_ERROR_CODES)[keyof typeof MAIL_ERROR_CODES];

/**
 * Section 15 - errors that mean "retrying will not help" (a config/input
 * problem, not a transient provider hiccup). Mirrors
 * `domain/extraction/extraction-error-codes.ts`'s
 * isRetryableExtractionError() philosophy exactly: everything NOT in this
 * set is assumed retryable up to maxAttempts, rather than requiring every
 * transient failure mode to be enumerated up front.
 */
const NON_RETRYABLE_MAIL_ERROR_CODES: ReadonlySet<string> = new Set([
  MAIL_ERROR_CODES.INVALID_RECIPIENT,
  MAIL_ERROR_CODES.SENDER_NOT_VERIFIED,
  MAIL_ERROR_CODES.PROVIDER_AUTH_FAILED,
  MAIL_ERROR_CODES.MAX_ATTEMPTS_REACHED,
  MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
]);

export function isRetryableMailError(errorCode: string, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  return !NON_RETRYABLE_MAIL_ERROR_CODES.has(errorCode);
}
