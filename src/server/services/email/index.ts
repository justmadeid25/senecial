import { NotImplementedError } from "@/lib/errors";
import { resolveEmailConfig } from "@/lib/config/email";
import type { TransactionalEmailSender } from "@/domain/email/transactional-email-sender";

import { PostmarkTransactionalMailer } from "./postmark-transactional-mailer";

export { classifyPostmarkError, toSafeMailErrorMessage } from "./mail-error";
export { classifyMailSendError, MailProviderError } from "./mail-provider-error";
export { probePostmarkServerIdentity } from "./postmark-transactional-mailer";

let cachedSender: TransactionalEmailSender | undefined;

/**
 * Phase 10B section 2 - dispatches on `EMAIL_PROVIDER`. Only `postmark` is
 * a real implementation in this Phase - `ses`/`resend`/`sendgrid` are
 * named here as documented extension points only (per section 2's "다른
 * 공급자는 interface 확장점만 유지하십시오") and fail loudly rather than
 * silently falling back to a working driver, so a misconfigured
 * deployment never discovers the gap by mail silently not sending.
 */
export function getTransactionalEmailSender(): TransactionalEmailSender {
  if (cachedSender) {
    return cachedSender;
  }

  const config = resolveEmailConfig();

  switch (config.provider) {
    case "postmark":
      cachedSender = new PostmarkTransactionalMailer(config);
      return cachedSender;
    case "ses":
    case "resend":
    case "sendgrid":
      throw new NotImplementedError(
        `EMAIL_PROVIDER=${config.provider}는 확장점으로만 정의되어 있으며 이번 Phase에서는 구현되지 않았습니다. EMAIL_PROVIDER=postmark를 사용하십시오.`
      );
    default:
      throw new Error(`지원하지 않는 EMAIL_PROVIDER 입니다: ${config.provider}`);
  }
}
