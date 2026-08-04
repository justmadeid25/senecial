import { resolveEmailConfig } from "@/lib/config/email";
import type { OrganizationInvitationMailer } from "@/domain/invitations/invitation-mailer";
import { getTransactionalEmailSender } from "@/server/services/email";

import { DevelopmentInvitationMailer } from "./development-invitation-mailer";
import { RealOrganizationInvitationMailer } from "./real-invitation-mailer";

let cachedMailer: OrganizationInvitationMailer | undefined;

/**
 * Returns the configured invitation mailer. `INVITATION_MAILER=development`
 * (the default) never sends real email and is refused outside development
 * unless explicitly overridden - see DevelopmentInvitationMailer's warning.
 * `INVITATION_MAILER=real` (Phase 10B) needs no override flag - it IS the
 * real production driver, wired to whichever provider `EMAIL_PROVIDER`
 * selects (see server/services/email).
 */
export function getInvitationMailer(): OrganizationInvitationMailer {
  if (cachedMailer) {
    return cachedMailer;
  }

  const driver = process.env.INVITATION_MAILER ?? "development";

  switch (driver) {
    case "development": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_DEVELOPMENT_INVITATION_MAILER !== "true"
      ) {
        throw new Error(
          "INVITATION_MAILER=development은 운영 환경에서 사용할 수 없습니다. 실제 이메일 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_INVITATION_MAILER=true를 설정하십시오."
        );
      }
      cachedMailer = new DevelopmentInvitationMailer();
      return cachedMailer;
    }
    case "real": {
      const config = resolveEmailConfig();
      cachedMailer = new RealOrganizationInvitationMailer(getTransactionalEmailSender(), config);
      return cachedMailer;
    }
    default:
      throw new Error(`지원하지 않는 INVITATION_MAILER 입니다: ${driver}`);
  }
}

/** Recorded on `MailDelivery.provider` - never exposed to end users, only for operator observability (see mail-delivery-repository.ts). */
export function getInvitationMailerProviderLabel(): string {
  return (process.env.INVITATION_MAILER ?? "development") === "real"
    ? (process.env.EMAIL_PROVIDER ?? "unknown")
    : "development";
}
