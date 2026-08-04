import { isTokenUsable } from "@/domain/account-security/token-expiry";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashSecurityToken } from "@/server/auth/security-token";
import { prisma } from "@/server/db/client";
import {
  findEmailVerificationTokenByHash,
  markEmailVerificationTokenUsed,
} from "@/server/repositories/email-verification-token-repository";

export interface VerifiedEmail {
  email: string;
}

/**
 * Public (no session required - the user may click this link before ever
 * logging in for the first time, since registerUser() does not auto-sign-in).
 * Re-validates token state (usable = unused and unexpired) at write time
 * inside the transaction, mirroring accept-invitation.ts's pattern.
 */
export async function verifyEmail(token: string): Promise<VerifiedEmail> {
  const tokenHash = hashSecurityToken(token);
  const record = await findEmailVerificationTokenByHash(tokenHash);
  if (!record) {
    throw new NotFoundError("유효하지 않은 인증 링크입니다.");
  }

  const now = new Date();
  if (!isTokenUsable(record, now)) {
    throw new ConflictError("만료되었거나 이미 사용된 인증 링크입니다.");
  }

  const email = await prisma.$transaction(async (tx) => {
    await markEmailVerificationTokenUsed(record.id, now, tx);
    const user = await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
      select: { id: true, email: true },
    });

    const membership = await tx.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    if (membership) {
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          userId: user.id,
          entityType: "User",
          entityId: user.id,
          action: AUDIT_ACTIONS.EMAIL_VERIFIED,
          metadata: {},
        },
      });
    }

    return user.email;
  });

  return { email };
}
