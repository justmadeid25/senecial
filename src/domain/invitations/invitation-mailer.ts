/**
 * Extension point for actually delivering an invitation email. No
 * implementation here may reference a specific email provider (SendGrid,
 * SES, Resend, ...) - provider-specific code belongs in
 * `server/services/invitations`.
 */
export interface OrganizationInvitationMailer {
  sendInvitation(input: {
    email: string;
    organizationName: string;
    inviterName: string;
    invitationUrl: string;
    expiresAt: Date;
    role: string;
    /** Phase 10B section 14 - only used to derive the mail idempotency key; never persisted by the mailer itself (see real-invitation-mailer.ts). */
    invitationId: string;
  }): Promise<{ providerMessageId?: string } | void>;
}
