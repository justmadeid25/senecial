import { MAIL_ERROR_CODES, type MailErrorCode } from "@/domain/email/mail-error-codes";
import { toSafeMailErrorMessage } from "./mail-error";

/** Thrown by any `TransactionalEmailSender` implementation (Postmark today, any future provider) on a failed send - the one exception type every caller in this codebase (inline send-tracking, the mail worker) knows how to classify. */
export class MailProviderError extends Error {
  readonly errorCode: MailErrorCode;

  constructor(errorCode: MailErrorCode, message: string) {
    super(message);
    this.name = "MailProviderError";
    this.errorCode = errorCode;
  }
}

/**
 * Section 16 - the single place that turns ANY thrown value from a mail
 * send attempt into a safe `{errorCode, errorMessage}` pair for
 * MailDelivery/logs. A `MailProviderError` (from a real provider
 * implementation) already carries a safe, pre-classified code; anything
 * else (an unexpected exception from the development mailer, a bug) falls
 * back to the same generic PROVIDER_UNAVAILABLE code rather than ever
 * inspecting/forwarding the raw error's own message.
 */
export function classifyMailSendError(error: unknown): { errorCode: MailErrorCode; errorMessage: string } {
  if (error instanceof MailProviderError) {
    return { errorCode: error.errorCode, errorMessage: toSafeMailErrorMessage(error.errorCode) };
  }
  return {
    errorCode: MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE,
    errorMessage: toSafeMailErrorMessage(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE),
  };
}
