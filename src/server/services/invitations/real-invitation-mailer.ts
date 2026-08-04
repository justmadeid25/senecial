import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildInvitationIdempotencyKey } from "@/domain/email/idempotency-key";
import { renderOrganizationInvitationEmail } from "@/domain/email/templates/organization-invitation";
import type { OrganizationInvitationMailer } from "@/domain/invitations/invitation-mailer";
import type { EmailConfig } from "@/lib/config/email";
import type { TransactionalEmailSender } from "@/domain/email/transactional-email-sender";

/**
 * Phase 10B section 2 - renders the invitation template and hands it to
 * the configured `TransactionalEmailSender` (Postmark). Deliberately does
 * NOT touch `MailDelivery` itself - that row is created atomically inside
 * the same transaction as the invitation row (create-invitation.ts) and
 * transitioned to SENT/FAILED by the CALLER right after this method
 * returns/throws (see send-tracked-mail.ts) - keeping this class a pure
 * "render + attempt delivery" unit, symmetric with
 * DevelopmentInvitationMailer, which the caller's tracking wrapper treats
 * identically regardless of which one actually ran.
 */
export class RealOrganizationInvitationMailer implements OrganizationInvitationMailer {
  constructor(
    private readonly sender: TransactionalEmailSender,
    private readonly config: EmailConfig
  ) {}

  async sendInvitation(input: {
    email: string;
    organizationName: string;
    inviterName: string;
    invitationUrl: string;
    expiresAt: Date;
    role: string;
    invitationId: string;
  }): Promise<{ providerMessageId?: string }> {
    const rendered = renderOrganizationInvitationEmail({
      organizationName: input.organizationName,
      inviterName: input.inviterName,
      role: input.role,
      invitationUrl: input.invitationUrl,
      expiresAt: input.expiresAt,
      supportAddress: this.config.supportAddress,
    });

    const result = await this.sender.send({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
      to: input.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: buildInvitationIdempotencyKey(input.invitationId),
    });
    return { providerMessageId: result.providerMessageId };
  }
}
