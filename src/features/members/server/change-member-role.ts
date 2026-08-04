import { MembershipRole } from "@/generated/prisma/enums";
import { isLastOwner } from "@/domain/members/last-owner-policy";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { changeMemberRoleSchema } from "@/lib/validation/members";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { prisma } from "@/server/db/client";
import {
  countOwners,
  findMembershipById,
  updateMembershipRole,
} from "@/server/repositories/membership-repository";

export interface ChangeMemberRoleParams {
  userId: string;
  organizationId: string;
  membershipId: string;
  input: unknown;
}

/**
 * OWNER only.
 *
 * - A user cannot change their own role (self-service role escalation /
 *   accidental self-demotion is blocked entirely - there is no legitimate
 *   product reason for it, and it removes an entire class of "did I just
 *   lock myself out" bugs).
 * - The last remaining OWNER cannot be demoted to MEMBER - checked inside
 *   the same transaction that performs the update, so a race between two
 *   concurrent demotions of two different OWNERs down to the last one
 *   cannot both succeed.
 */
export async function changeMemberRole(params: ChangeMemberRoleParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsed = changeMemberRoleSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }
  const nextRole = parsed.data.role;

  const target = await findMembershipById({
    organizationId: authContext.organizationId,
    membershipId: params.membershipId,
  });
  if (!target) {
    throw new NotFoundError();
  }

  if (target.userId === authContext.userId) {
    throw new ForbiddenError("본인의 역할은 직접 변경할 수 없습니다.");
  }

  await prisma.$transaction(async (tx) => {
    if (target.role === MembershipRole.OWNER && nextRole !== MembershipRole.OWNER) {
      const ownerCount = await countOwners(authContext.organizationId, tx);
      if (isLastOwner(ownerCount)) {
        throw new ConflictError("마지막 OWNER는 강등할 수 없습니다.");
      }
    }

    const updated = await updateMembershipRole(
      { organizationId: authContext.organizationId, membershipId: target.id, role: nextRole },
      tx
    );
    if (!updated) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Membership",
        entityId: target.id,
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        metadata: {
          membershipId: target.id,
          targetUserId: target.userId,
          previousRole: target.role,
          nextRole,
        },
      },
    });
  });
}
