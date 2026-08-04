import { MembershipRole } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { prisma } from "@/server/db/client";
import {
  findInvitationById,
  revokeInvitation as revokeInvitationRow,
} from "@/server/repositories/invitation-repository";

export interface RevokeInvitationParams {
  userId: string;
  organizationId: string;
  invitationId: string;
}

/** OWNER only. Idempotent-NotFound, not idempotent-success - matches the delete conventions used elsewhere in this codebase. */
export async function revokeInvitation(params: RevokeInvitationParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const existing = await findInvitationById({
    organizationId: authContext.organizationId,
    invitationId: params.invitationId,
  });
  if (!existing || existing.acceptedAt || existing.revokedAt) {
    throw new NotFoundError();
  }

  await prisma.$transaction(async (tx) => {
    const revoked = await revokeInvitationRow(
      {
        organizationId: authContext.organizationId,
        invitationId: existing.id,
        revokedAt: new Date(),
      },
      tx
    );

    if (!revoked) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "OrganizationInvitation",
        entityId: existing.id,
        action: AUDIT_ACTIONS.MEMBER_INVITATION_REVOKED,
        metadata: { invitationId: existing.id, email: existing.email },
      },
    });
  });
}
