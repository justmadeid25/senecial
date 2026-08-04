import { MembershipRole } from "@/generated/prisma/enums";
import { isInvitationExpired } from "@/domain/invitations/invitation-expiry";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { findLiveInvitationsByOrganization } from "@/server/repositories/invitation-repository";

export interface PendingInvitationListItem {
  id: string;
  email: string;
  role: MembershipRole;
  invitedByName: string;
  expiresAt: Date;
  isExpired: boolean;
  createdAt: Date;
}

export interface ListInvitationsParams {
  userId: string;
  organizationId: string;
}

/** OWNER only - the invitation list is part of member management. */
export async function listInvitations(
  params: ListInvitationsParams
): Promise<PendingInvitationListItem[]> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const invitations = await findLiveInvitationsByOrganization(authContext.organizationId);
  const now = new Date();

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedByName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
    isExpired: isInvitationExpired(invitation.expiresAt, now),
    createdAt: invitation.createdAt,
  }));
}
