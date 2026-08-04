import { MembershipRole } from "@/generated/prisma/enums";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildInvitationResendIdempotencyKey } from "@/domain/email/idempotency-key";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { computeInvitationExpiresAt } from "@/domain/invitations/invitation-expiry";
import { buildInvitationUrl } from "@/domain/invitations/invitation-url";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { generateInvitationToken, hashInvitationToken } from "@/server/auth/invitation-token";
import { prisma } from "@/server/db/client";
import { findInvitationById, rotateInvitationToken } from "@/server/repositories/invitation-repository";
import { enqueuePendingMailDelivery } from "@/server/repositories/mail-delivery-repository";

import { deliverInvitationMail } from "./deliver-invitation-mail";

export interface ResendInvitationParams {
  userId: string;
  organizationId: string;
  invitationId: string;
}

export interface ResendedInvitation {
  id: string;
  email: string;
  expiresAt: Date;
  invitationUrl: string;
}

/**
 * OWNER only. Phase 10B section 19 - rotates to a brand new token
 * (invalidating the old one, see rotateInvitationToken()'s docstring)
 * rather than re-sending the original link, so an old, possibly-leaked
 * invitation URL stops working the moment a resend happens.
 */
export async function resendInvitation(params: ResendInvitationParams): Promise<ResendedInvitation> {
  const authContext = await verifyOrganizationRole(params.userId, params.organizationId, MembershipRole.OWNER);

  const existing = await findInvitationById({
    organizationId: authContext.organizationId,
    invitationId: params.invitationId,
  });
  if (!existing) {
    throw new NotFoundError();
  }
  if (existing.acceptedAt || existing.revokedAt) {
    throw new ConflictError("이미 수락되었거나 취소된 초대는 재발송할 수 없습니다.");
  }

  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = computeInvitationExpiresAt(new Date());

  const { rotated, mailDeliveryId } = await prisma.$transaction(async (tx) => {
    const updated = await rotateInvitationToken(
      { organizationId: authContext.organizationId, invitationId: existing.id, tokenHash, expiresAt },
      tx
    );
    if (!updated) {
      throw new ConflictError("이미 수락되었거나 취소된 초대는 재발송할 수 없습니다.");
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "OrganizationInvitation",
        entityId: updated.id,
        action: AUDIT_ACTIONS.MEMBER_INVITATION_RESENT,
        metadata: { invitationId: updated.id, email: updated.email, resendCount: updated.resendCount },
      },
    });

    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
        recipientHash: hashRecipient(updated.email),
        idempotencyKey: buildInvitationResendIdempotencyKey(updated.id, updated.resendCount),
      },
      tx
    );

    return { rotated: updated, mailDeliveryId: mailDelivery?.id };
  });

  const invitationUrl = buildInvitationUrl(process.env.APP_URL ?? "http://localhost:3000", token);

  if (mailDeliveryId) {
    const [inviter, organization] = await Promise.all([
      prisma.user.findUnique({ where: { id: authContext.userId }, select: { name: true } }),
      prisma.organization.findUnique({ where: { id: authContext.organizationId }, select: { name: true } }),
    ]);
    if (!inviter || !organization) {
      throw new ValidationError("초대를 재발송할 수 없습니다.");
    }

    await deliverInvitationMail({
      mailDeliveryId,
      email: rotated.email,
      organizationName: organization.name,
      inviterName: inviter.name,
      invitationUrl,
      expiresAt,
      role: rotated.role,
      invitationId: rotated.id,
    });
  }

  return { id: rotated.id, email: rotated.email, expiresAt: rotated.expiresAt, invitationUrl };
}
