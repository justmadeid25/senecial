import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildPasswordResetIdempotencyKey } from "@/domain/email/idempotency-key";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { computeTokenExpiresAt } from "@/domain/account-security/token-expiry";
import { buildPasswordResetUrl } from "@/domain/account-security/urls";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { PASSWORD_RESET_TOKEN_HOURS } from "@/lib/config/account-security";
import { requestPasswordResetSchema } from "@/lib/validation/auth";
import { generateSecurityToken, hashSecurityToken } from "@/server/auth/security-token";
import { prisma } from "@/server/db/client";
import {
  createPasswordResetToken,
  invalidateActivePasswordResetTokens,
} from "@/server/repositories/password-reset-token-repository";
import { enqueuePendingMailDelivery } from "@/server/repositories/mail-delivery-repository";
import { getAccountSecurityMailer, getAccountSecurityMailerProviderLabel } from "@/server/services/account-security";
import { sendTrackedMail } from "@/server/services/email/send-tracked-mail";

/**
 * §18 - always resolves successfully and does the same amount of
 * user-visible work regardless of whether `email` belongs to a real
 * account: the caller (request-password-reset-action.ts) always shows the
 * same "입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다." message no
 * matter what this function does internally. An invalid email FORMAT is
 * still safe to reject early (that is a client-side input error, not an
 * account-existence signal), but an email that simply does not match any
 * user silently no-ops here rather than throwing.
 */
export async function requestPasswordReset(input: unknown): Promise<void> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true },
  });
  if (!user) {
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });

  const now = new Date();
  const expiresAt = computeTokenExpiresAt(now, PASSWORD_RESET_TOKEN_HOURS);
  const token = generateSecurityToken();
  const tokenHash = hashSecurityToken(token);

  const { mailDeliveryId, passwordResetTokenId } = await prisma.$transaction(async (tx) => {
    await invalidateActivePasswordResetTokens(user.id, now, tx);
    const created = await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt }, tx);

    if (membership) {
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          userId: user.id,
          entityType: "User",
          entityId: user.id,
          action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
          metadata: {},
        },
      });
    }

    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: membership?.organizationId,
        userId: user.id,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
        recipientHash: hashRecipient(user.email),
        idempotencyKey: buildPasswordResetIdempotencyKey(created.id),
      },
      tx
    );

    return { mailDeliveryId: mailDelivery?.id, passwordResetTokenId: created.id };
  });

  const resetUrl = buildPasswordResetUrl(process.env.APP_URL ?? "http://localhost:3000", token);

  if (mailDeliveryId) {
    try {
      await sendTrackedMail({
        mailDeliveryId,
        provider: getAccountSecurityMailerProviderLabel(),
        send: () =>
          getAccountSecurityMailer().sendPasswordReset({
            to: user.email,
            resetUrl,
            expiresAt,
            passwordResetTokenId,
          }),
      });
    } catch (error) {
      console.error(`Failed to send password reset email to user ${user.id}:`, error);
    }
  }
}
