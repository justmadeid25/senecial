import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import {
  buildEmailVerificationIdempotencyKey,
  buildPasswordResetIdempotencyKey,
} from "@/domain/email/idempotency-key";
import { renderEmailVerificationEmail } from "@/domain/email/templates/email-verification";
import { renderPasswordChangedEmail } from "@/domain/email/templates/password-changed";
import { renderPasswordResetEmail } from "@/domain/email/templates/password-reset";
import type { AccountSecurityMailer } from "@/domain/account-security/mailer";
import type { EmailConfig } from "@/lib/config/email";
import type { TransactionalEmailSender } from "@/domain/email/transactional-email-sender";

/**
 * Phase 10B section 2 - same "pure render + attempt delivery, never
 * touches MailDelivery" contract as RealOrganizationInvitationMailer. The
 * two token-bearing methods are tracked inline by their callers
 * (request-email-verification.ts / request-password-reset.ts);
 * sendPasswordChangedNotice is only ever called by the mail worker (see
 * process-mail-deliveries.ts), which owns the MailDelivery transition
 * itself.
 */
export class RealAccountSecurityMailer implements AccountSecurityMailer {
  constructor(
    private readonly sender: TransactionalEmailSender,
    private readonly config: EmailConfig
  ) {}

  async sendEmailVerification(input: {
    to: string;
    verificationUrl: string;
    expiresAt: Date;
    emailVerificationTokenId: string;
  }): Promise<{ providerMessageId?: string }> {
    const rendered = renderEmailVerificationEmail({
      verificationUrl: input.verificationUrl,
      expiresAt: input.expiresAt,
      supportAddress: this.config.supportAddress,
    });
    const result = await this.sender.send({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: buildEmailVerificationIdempotencyKey(input.emailVerificationTokenId),
    });
    return { providerMessageId: result.providerMessageId };
  }

  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
    passwordResetTokenId: string;
  }): Promise<{ providerMessageId?: string }> {
    const rendered = renderPasswordResetEmail({
      resetUrl: input.resetUrl,
      expiresAt: input.expiresAt,
      supportAddress: this.config.supportAddress,
    });
    const result = await this.sender.send({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: buildPasswordResetIdempotencyKey(input.passwordResetTokenId),
    });
    return { providerMessageId: result.providerMessageId };
  }

  async sendPasswordChangedNotice(input: { to: string; idempotencyKey: string }): Promise<{ providerMessageId?: string }> {
    const rendered = renderPasswordChangedEmail({
      changedAt: new Date(),
      forgotPasswordUrl: `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/forgot-password`,
      supportAddress: this.config.supportAddress,
    });
    const result = await this.sender.send({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED,
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: input.idempotencyKey,
    });
    return { providerMessageId: result.providerMessageId };
  }
}
