/**
 * §21 - never sends the token itself as a parameter here; callers pass a
 * fully-built URL (see urls.ts) so the mailer implementation never has to
 * know the token format or app URL construction.
 */
export interface AccountSecurityMailer {
  sendEmailVerification(input: {
    to: string;
    verificationUrl: string;
    expiresAt: Date;
    /** Phase 10B section 14 - only used to derive the mail idempotency key; never persisted by the mailer itself. */
    emailVerificationTokenId: string;
  }): Promise<{ providerMessageId?: string } | void>;
  sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
    passwordResetTokenId: string;
  }): Promise<{ providerMessageId?: string } | void>;
  /** `idempotencyKey` is sourced from the already-created MailDelivery row (see mail worker) rather than derived here - password-changed notices go through the async outbox, unlike the other two methods on this interface. */
  sendPasswordChangedNotice(input: { to: string; idempotencyKey: string }): Promise<{ providerMessageId?: string } | void>;
}
