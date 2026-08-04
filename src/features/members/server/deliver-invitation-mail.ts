import { getInvitationMailer, getInvitationMailerProviderLabel } from "@/server/services/invitations";
import { sendTrackedMail } from "@/server/services/email/send-tracked-mail";

/**
 * Shared by create-invitation.ts and resend-invitation.ts - both create a
 * PENDING MailDelivery row atomically inside their own DB transaction
 * (see mail-delivery-repository.ts's enqueuePendingMailDelivery()), then
 * call this right after the transaction commits to actually attempt
 * delivery and transition that row to SENT/FAILED.
 *
 * A send failure is caught and only logged (never rethrown to the
 * caller) - unchanged from Phase 9's behavior: a transient email-provider
 * outage must not make invitation creation/resend itself appear to fail,
 * since the invitation row and its link already exist and are valid
 * regardless of whether the email happened to arrive.
 */
export async function deliverInvitationMail(params: {
  mailDeliveryId: string;
  email: string;
  organizationName: string;
  inviterName: string;
  invitationUrl: string;
  expiresAt: Date;
  role: string;
  invitationId: string;
}): Promise<void> {
  try {
    await sendTrackedMail({
      mailDeliveryId: params.mailDeliveryId,
      provider: getInvitationMailerProviderLabel(),
      send: () =>
        getInvitationMailer().sendInvitation({
          email: params.email,
          organizationName: params.organizationName,
          inviterName: params.inviterName,
          invitationUrl: params.invitationUrl,
          expiresAt: params.expiresAt,
          role: params.role,
          invitationId: params.invitationId,
        }),
    });
  } catch (error) {
    console.error(`Failed to send invitation email for invitation ${params.invitationId}:`, error);
  }
}
