import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import type { OrganizationInvitationMailer } from "@/domain/invitations/invitation-mailer";
import { writeTestMailboxEntry } from "@/server/services/mailbox/test-mailbox";

/**
 * !!! DEVELOPMENT ONLY - SENDS NO REAL EMAIL !!!
 *
 * Logs the invitation URL to the server console so a developer running
 * locally can copy it manually. The create-invitation service also returns
 * the URL directly in its result so the inviting OWNER can see/copy it in
 * the UI without needing server log access - a deliberate development
 * convenience. A production deployment must replace this with a real
 * email provider (see getInvitationMailer() in ./index.ts, which refuses
 * to use this class in production unless explicitly overridden).
 */
export class DevelopmentInvitationMailer implements OrganizationInvitationMailer {
  async sendInvitation(input: {
    email: string;
    organizationName: string;
    inviterName: string;
    invitationUrl: string;
    expiresAt: Date;
    role: string;
    invitationId: string;
  }): Promise<void> {
    console.log(
      `[DevelopmentInvitationMailer] ${input.inviterName} invited ${input.email} (role=${input.role}) to join "${input.organizationName}". ` +
        `Link: ${input.invitationUrl} (expires ${input.expiresAt.toISOString()})`
    );
    await writeTestMailboxEntry({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
      to: input.email,
      url: input.invitationUrl,
    });
  }
}
