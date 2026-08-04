import { isInvitationExpired } from "@/domain/invitations/invitation-expiry";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashInvitationToken } from "@/server/auth/invitation-token";
import { prisma } from "@/server/db/client";
import { isUniqueConstraintViolation } from "@/server/db/prisma-errors";
import {
  findInvitationByTokenHash,
  markInvitationAccepted,
} from "@/server/repositories/invitation-repository";

export interface AcceptInvitationParams {
  userId: string;
  token: string;
}

export interface AcceptedInvitation {
  organizationId: string;
  organizationName: string;
}

/**
 * For an ALREADY authenticated user accepting an invitation to a
 * (typically different) organization. Re-validates everything about the
 * invitation's state *inside* the transaction, not just before it - the
 * outer read below is only used to fail fast with a clear message; the
 * actual atomicity guarantee against double-accept races comes from
 * markInvitationAccepted()'s scoped updateMany re-checking
 * acceptedAt/revokedAt at write time.
 */
export async function acceptInvitation(
  params: AcceptInvitationParams
): Promise<AcceptedInvitation> {
  const tokenHash = hashInvitationToken(params.token);

  const invitation = await findInvitationByTokenHash(tokenHash);
  if (!invitation) {
    throw new NotFoundError("초대를 찾을 수 없습니다.");
  }
  if (invitation.revokedAt) {
    throw new ConflictError("취소된 초대입니다.");
  }
  if (invitation.acceptedAt) {
    throw new ConflictError("이미 수락된 초대입니다.");
  }
  if (isInvitationExpired(invitation.expiresAt, new Date())) {
    throw new ConflictError("만료된 초대입니다.");
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new ValidationError();
  }
  if (user.email !== invitation.email) {
    throw new ForbiddenError(
      "이 초대는 현재 로그인한 계정의 이메일과 일치하지 않습니다."
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { id: invitation.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) {
    throw new NotFoundError();
  }

  await prisma.$transaction(async (tx) => {
    try {
      await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: invitation.role },
      });
    } catch (error) {
      // Already a member (e.g. re-opened the same link after a previous
      // successful accept raced this one) - the unique(userId,
      // organizationId) constraint caught it. That's fine: the desired
      // end state (user is a member) already holds, so fall through to
      // marking the invitation accepted rather than failing the request.
      if (!isUniqueConstraintViolation(error, "userId")) {
        throw error;
      }
    }

    const accepted = await markInvitationAccepted(
      {
        organizationId: invitation.organizationId,
        invitationId: invitation.id,
        acceptedAt: new Date(),
      },
      tx
    );
    if (!accepted) {
      // Someone else (or this same request, retried) already
      // accepted/revoked it between our outer read and here.
      throw new ConflictError("이미 처리된 초대입니다.");
    }

    await tx.auditLog.create({
      data: {
        organizationId: invitation.organizationId,
        userId: user.id,
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        action: AUDIT_ACTIONS.MEMBER_INVITATION_ACCEPTED,
        metadata: { invitationId: invitation.id, role: invitation.role },
      },
    });
  });

  return { organizationId: organization.id, organizationName: organization.name };
}
