import { isTokenUsable } from "@/domain/account-security/token-expiry";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildPasswordChangedIdempotencyKey } from "@/domain/email/idempotency-key";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { passwordHasher } from "@/server/auth/password-hasher";
import { hashSecurityToken } from "@/server/auth/security-token";
import { prisma } from "@/server/db/client";
import {
  findPasswordResetTokenByHash,
  invalidateActivePasswordResetTokens,
  markPasswordResetTokenUsed,
} from "@/server/repositories/password-reset-token-repository";
import { enqueuePendingMailDelivery } from "@/server/repositories/mail-delivery-repository";

/**
 * Public (token-based, no session required - the user is, by definition,
 * locked out or resetting a forgotten password). Bumps `sessionVersion`
 * so every JWT issued before this reset stops being treated as valid (see
 * §22 / requireAuthenticatedUser()'s sessionVersion check) - a stolen
 * session cannot survive a password reset even though JWTs have no
 * server-side revocation list of their own.
 */
export async function resetPassword(input: unknown): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.");
  }

  const tokenHash = hashSecurityToken(parsed.data.token);
  const record = await findPasswordResetTokenByHash(tokenHash);
  if (!record) {
    throw new NotFoundError("유효하지 않은 재설정 링크입니다.");
  }

  const now = new Date();
  if (!isTokenUsable(record, now)) {
    throw new ConflictError("만료되었거나 이미 사용된 재설정 링크입니다.");
  }

  const passwordHash = await passwordHasher.hash(parsed.data.password);

  await prisma.$transaction(async (tx) => {
    await markPasswordResetTokenUsed(record.id, now, tx);
    await invalidateActivePasswordResetTokens(record.userId, now, tx);

    const updated = await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { id: true, email: true, sessionVersion: true },
    });

    const membership = await tx.membership.findFirst({
      where: { userId: updated.id },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    if (membership) {
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          userId: updated.id,
          entityType: "User",
          entityId: updated.id,
          action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
          metadata: {},
        },
      });
    }

    // §12 - PASSWORD_CHANGED is the one message type genuinely deferred to
    // the async mail worker (see schema.prisma's MailDelivery docstring) -
    // no secret token is embedded in this notice, so the worker can safely
    // re-fetch the user's current email at send time. Keyed on
    // (userId, sessionVersion) - already incremented exactly once above -
    // so this is naturally idempotent per password-change event without
    // needing its own dedicated row/token.
    await enqueuePendingMailDelivery(
      {
        organizationId: membership?.organizationId,
        userId: updated.id,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED,
        recipientHash: hashRecipient(updated.email),
        idempotencyKey: buildPasswordChangedIdempotencyKey(updated.id, updated.sessionVersion),
      },
      tx
    );
  });
}
