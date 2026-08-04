import { MembershipRole } from "@/generated/prisma/enums";
import { isLastOwner } from "@/domain/members/last-owner-policy";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { prisma } from "@/server/db/client";
import {
  countOwners,
  deleteMembership,
  findMembershipById,
} from "@/server/repositories/membership-repository";

export interface RemoveMemberParams {
  userId: string;
  organizationId: string;
  membershipId: string;
}

/**
 * OWNER only. Hard delete (Membership has no deletedAt - see README).
 * Self-removal is blocked (an OWNER should not be able to accidentally
 * remove their own access to the organization through this control - if
 * they want to leave, that is a different, more deliberate flow this
 * phase does not implement). The last remaining OWNER cannot be removed,
 * checked inside the same transaction as the delete.
 */
export async function removeMember(params: RemoveMemberParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const target = await findMembershipById({
    organizationId: authContext.organizationId,
    membershipId: params.membershipId,
  });
  if (!target) {
    throw new NotFoundError();
  }

  if (target.userId === authContext.userId) {
    throw new ForbiddenError("본인은 제거할 수 없습니다.");
  }

  await prisma.$transaction(async (tx) => {
    if (target.role === MembershipRole.OWNER) {
      const ownerCount = await countOwners(authContext.organizationId, tx);
      if (isLastOwner(ownerCount)) {
        throw new ConflictError("마지막 OWNER는 제거할 수 없습니다.");
      }
    }

    const removed = await deleteMembership(
      { organizationId: authContext.organizationId, membershipId: target.id },
      tx
    );
    if (!removed) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Membership",
        entityId: target.id,
        action: AUDIT_ACTIONS.MEMBER_REMOVED,
        metadata: { membershipId: target.id, targetUserId: target.userId, role: target.role },
      },
    });
  });
}
