import type { MembershipRole } from "@/generated/prisma/enums";
import { isInvitationExpired } from "@/domain/invitations/invitation-expiry";
import { hashInvitationToken } from "@/server/auth/invitation-token";
import { findInvitationByTokenHash } from "@/server/repositories/invitation-repository";
import { prisma } from "@/server/db/client";

export type InvitationLookupResult =
  | {
      status: "valid";
      invitationId: string;
      email: string;
      organizationName: string;
      role: MembershipRole;
      expiresAt: Date;
      invitedByName: string;
    }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "accepted" };

/**
 * Public lookup - no authentication required, since a logged-out visitor
 * must be able to see "you're invited to join X" before being asked to log
 * in or sign up. Only ever returns non-sensitive fields: never the
 * tokenHash, never the inviter's id, never anything not already implied by
 * possession of the link itself.
 */
export async function getInvitationByToken(token: string): Promise<InvitationLookupResult> {
  const tokenHash = hashInvitationToken(token);
  const invitation = await findInvitationByTokenHash(tokenHash);

  if (!invitation) {
    return { status: "not_found" };
  }
  if (invitation.revokedAt) {
    return { status: "revoked" };
  }
  if (invitation.acceptedAt) {
    return { status: "accepted" };
  }
  if (isInvitationExpired(invitation.expiresAt, new Date())) {
    return { status: "expired" };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: invitation.organizationId },
    select: { name: true },
  });
  if (!organization) {
    return { status: "not_found" };
  }

  return {
    status: "valid",
    invitationId: invitation.id,
    email: invitation.email,
    organizationName: organization.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    invitedByName: invitation.invitedBy.name,
  };
}
