import { isInvitationExpired } from "@/domain/invitations/invitation-expiry";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, ValidationError } from "@/lib/errors";
import { registerAndAcceptInvitationSchema } from "@/lib/validation/invitations";
import { passwordHasher } from "@/server/auth/password-hasher";
import { hashInvitationToken } from "@/server/auth/invitation-token";
import { prisma } from "@/server/db/client";
import { isUniqueConstraintViolation } from "@/server/db/prisma-errors";
import {
  findInvitationByTokenHash,
  markInvitationAccepted,
} from "@/server/repositories/invitation-repository";

export interface RegisterAndAcceptInvitationParams {
  token: string;
  input: unknown;
}

export interface RegisteredAndAcceptedInvitation {
  userId: string;
  organizationId: string;
}

/**
 * For a brand-new user who does not have an account yet, reached via an
 * invitation link. Creates the User row and its Membership in the invited
 * organization atomically - there is no intermediate state where the User
 * exists without the Membership the invitation promised, and no path
 * where a mismatched email can be used.
 *
 * The account email is ALWAYS taken from the resolved invitation record,
 * never from client input - the signup form for this flow only collects
 * name/password (see the /invitations/[token] screen), so there is no
 * "email" field for a client to tamper with in the first place.
 */
export async function registerAndAcceptInvitation(
  params: RegisterAndAcceptInvitationParams
): Promise<RegisteredAndAcceptedInvitation> {
  const parsed = registerAndAcceptInvitationSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }
  const { name, password } = parsed.data;

  const tokenHash = hashInvitationToken(params.token);
  const invitation = await findInvitationByTokenHash(tokenHash);
  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new ConflictError("유효하지 않거나 이미 처리된 초대입니다.");
  }
  if (isInvitationExpired(invitation.expiresAt, new Date())) {
    throw new ConflictError("만료된 초대입니다.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (existingUser) {
    throw new ConflictError(
      "이미 계정이 있는 이메일입니다. 로그인 후 초대를 수락해 주세요."
    );
  }

  const passwordHash = await passwordHasher.hash(password);

  const result = await prisma.$transaction(async (tx) => {
    // Re-checked inside the transaction (not just above) so a concurrent
    // signup/accept for the same invitation cannot both succeed.
    const stillLive = await tx.organizationInvitation.findFirst({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
    });
    if (!stillLive) {
      throw new ConflictError("유효하지 않거나 이미 처리된 초대입니다.");
    }

    let user;
    try {
      user = await tx.user.create({
        data: {
          name,
          email: invitation.email,
          passwordHash,
          memberships: {
            create: { organizationId: invitation.organizationId, role: invitation.role },
          },
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "email")) {
        throw new ConflictError(
          "이미 계정이 있는 이메일입니다. 로그인 후 초대를 수락해 주세요."
        );
      }
      throw error;
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
      throw new ConflictError("유효하지 않거나 이미 처리된 초대입니다.");
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

    return { userId: user.id, organizationId: invitation.organizationId };
  });

  return result;
}
