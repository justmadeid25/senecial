import { MembershipRole } from "@/generated/prisma/enums";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildInvitationIdempotencyKey } from "@/domain/email/idempotency-key";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { computeInvitationExpiresAt } from "@/domain/invitations/invitation-expiry";
import { buildInvitationUrl } from "@/domain/invitations/invitation-url";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ValidationError } from "@/lib/errors";
import { createInvitationSchema } from "@/lib/validation/invitations";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { generateInvitationToken, hashInvitationToken } from "@/server/auth/invitation-token";
import { prisma } from "@/server/db/client";
import {
  createInvitation as createInvitationRow,
  findLiveInvitationByEmail,
} from "@/server/repositories/invitation-repository";
import { enqueuePendingMailDelivery } from "@/server/repositories/mail-delivery-repository";
import { findMembershipByUserAndOrganization } from "@/server/repositories/membership-repository";

import { deliverInvitationMail } from "./deliver-invitation-mail";

export interface CreateInvitationParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

export interface CreatedInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
  /**
   * The actual invitation link, only ever returned here to the OWNER who
   * just created it (their own action's result) - see
   * DevelopmentInvitationMailer's warning for why this exists at all while
   * no real mailer is wired up.
   */
  invitationUrl: string;
}

/**
 * OWNER only. Creates an invitation row and (best-effort) sends it via the
 * configured mailer. A mailer failure does not roll back the invitation -
 * the link is still valid and, in development, already visible to the
 * OWNER in the UI response - so a transient email-provider outage should
 * not prevent the invitation from existing.
 */
export async function createInvitation(
  params: CreateInvitationParams
): Promise<CreatedInvitation> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsed = createInvitationSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }
  const { email, role } = parsed.data;

  const [inviter, organization, existingUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: authContext.userId }, select: { id: true, name: true } }),
    prisma.organization.findUnique({ where: { id: authContext.organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (!inviter || !organization) {
    throw new ValidationError("초대를 생성할 수 없습니다.");
  }

  if (existingUser) {
    const existingMembership = await findMembershipByUserAndOrganization({
      organizationId: authContext.organizationId,
      userId: existingUser.id,
    });
    if (existingMembership) {
      throw new ConflictError("이미 이 조직의 구성원인 사용자입니다.");
    }
  }

  const existingInvitation = await findLiveInvitationByEmail({
    organizationId: authContext.organizationId,
    email,
  });
  if (existingInvitation) {
    throw new ConflictError("이미 이 이메일로 대기 중인 초대가 있습니다.");
  }

  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const now = new Date();
  const expiresAt = computeInvitationExpiresAt(now);

  const { created, mailDeliveryId } = await prisma.$transaction(async (tx) => {
    const invitation = await createInvitationRow(
      {
        organizationId: authContext.organizationId,
        email,
        role,
        tokenHash,
        invitedById: authContext.userId,
        expiresAt,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        action: AUDIT_ACTIONS.MEMBER_INVITED,
        // The invited email is core identifying information for this
        // specific audit action (an entry that doesn't say who was
        // invited is useless) - unlike a counterparty's contact email,
        // which is peripheral and deliberately excluded elsewhere.
        metadata: { invitationId: invitation.id, email: invitation.email, role },
      },
    });

    // §27 - atomic with the invitation row itself, not created afterward.
    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
        recipientHash: hashRecipient(email),
        idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      },
      tx
    );

    return { created: invitation, mailDeliveryId: mailDelivery?.id };
  });

  const invitationUrl = buildInvitationUrl(process.env.APP_URL ?? "http://localhost:3000", token);

  if (mailDeliveryId) {
    await deliverInvitationMail({
      mailDeliveryId,
      email,
      organizationName: organization.name,
      inviterName: inviter.name,
      invitationUrl,
      expiresAt,
      role,
      invitationId: created.id,
    });
  }

  return {
    id: created.id,
    email: created.email,
    role: created.role,
    expiresAt: created.expiresAt,
    invitationUrl,
  };
}
