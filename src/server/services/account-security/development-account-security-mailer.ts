import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import type { AccountSecurityMailer } from "@/domain/account-security/mailer";
import { writeTestMailboxEntry } from "@/server/services/mailbox/test-mailbox";

/**
 * !!! DEVELOPMENT ONLY - SENDS NO REAL EMAIL !!!
 *
 * Logs each URL to the server console only - unlike
 * DevelopmentInvitationMailer, these URLs are never also returned in a
 * Server Action's response, since (unlike an OWNER inviting someone else)
 * both email verification resend and password reset request must behave
 * identically whether or not the target account exists (§18) - returning
 * the URL to the caller would leak that. A production deployment must
 * replace this with a real email provider - see
 * getAccountSecurityMailer(), which refuses this class in production
 * unless explicitly overridden.
 */
export class DevelopmentAccountSecurityMailer implements AccountSecurityMailer {
  async sendEmailVerification(input: {
    to: string;
    verificationUrl: string;
    expiresAt: Date;
    emailVerificationTokenId: string;
  }): Promise<void> {
    console.log(
      `[DevelopmentAccountSecurityMailer] email verification for ${input.to}: ${input.verificationUrl} ` +
        `(expires ${input.expiresAt.toISOString()})`
    );
    await writeTestMailboxEntry({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
      to: input.to,
      url: input.verificationUrl,
    });
  }

  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
    passwordResetTokenId: string;
  }): Promise<void> {
    console.log(
      `[DevelopmentAccountSecurityMailer] password reset for ${input.to}: ${input.resetUrl} ` +
        `(expires ${input.expiresAt.toISOString()})`
    );
    await writeTestMailboxEntry({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
      to: input.to,
      url: input.resetUrl,
    });
  }

  async sendPasswordChangedNotice(input: { to: string; idempotencyKey: string }): Promise<void> {
    console.log(`[DevelopmentAccountSecurityMailer] password changed notice for ${input.to}`);
    await writeTestMailboxEntry({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED,
      to: input.to,
      url: "",
    });
  }
}
