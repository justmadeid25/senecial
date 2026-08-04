import { resolveEmailConfig } from "@/lib/config/email";
import type { AccountSecurityMailer } from "@/domain/account-security/mailer";
import { getTransactionalEmailSender } from "@/server/services/email";

import { DevelopmentAccountSecurityMailer } from "./development-account-security-mailer";
import { RealAccountSecurityMailer } from "./real-account-security-mailer";

let cachedMailer: AccountSecurityMailer | undefined;

/**
 * Returns the configured account-security mailer.
 * `ACCOUNT_SECURITY_MAILER=development` (the default) never sends real
 * email and is refused outside development unless explicitly overridden -
 * same guard pattern as getInvitationMailer(). `ACCOUNT_SECURITY_MAILER=real`
 * (Phase 10B) needs no override flag.
 */
export function getAccountSecurityMailer(): AccountSecurityMailer {
  if (cachedMailer) {
    return cachedMailer;
  }

  const driver = process.env.ACCOUNT_SECURITY_MAILER ?? "development";

  switch (driver) {
    case "development": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER !== "true"
      ) {
        throw new Error(
          "ACCOUNT_SECURITY_MAILER=development은 운영 환경에서 사용할 수 없습니다. 실제 이메일 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER=true를 설정하십시오."
        );
      }
      cachedMailer = new DevelopmentAccountSecurityMailer();
      return cachedMailer;
    }
    case "real": {
      const config = resolveEmailConfig();
      cachedMailer = new RealAccountSecurityMailer(getTransactionalEmailSender(), config);
      return cachedMailer;
    }
    default:
      throw new Error(`지원하지 않는 ACCOUNT_SECURITY_MAILER 입니다: ${driver}`);
  }
}

/** Recorded on `MailDelivery.provider` - never exposed to end users. */
export function getAccountSecurityMailerProviderLabel(): string {
  return (process.env.ACCOUNT_SECURITY_MAILER ?? "development") === "real"
    ? (process.env.EMAIL_PROVIDER ?? "unknown")
    : "development";
}
