import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { buildEmailVerificationIdempotencyKey } from "@/domain/email/idempotency-key";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { computeTokenExpiresAt } from "@/domain/account-security/token-expiry";
import { buildEmailVerificationUrl } from "@/domain/account-security/urls";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { EMAIL_VERIFICATION_TOKEN_HOURS } from "@/lib/config/account-security";
import { generateSecurityToken, hashSecurityToken } from "@/server/auth/security-token";
import { prisma } from "@/server/db/client";
import {
  createEmailVerificationToken,
  invalidateActiveEmailVerificationTokens,
} from "@/server/repositories/email-verification-token-repository";
import { enqueuePendingMailDelivery } from "@/server/repositories/mail-delivery-repository";
import { getAccountSecurityMailer, getAccountSecurityMailerProviderLabel } from "@/server/services/account-security";
import { sendTrackedMail } from "@/server/services/email/send-tracked-mail";

/**
 * For an already-authenticated user resending their own verification
 * email - unlike request-password-reset.ts, this does not need to hide
 * whether the account exists (the caller IS the account), so it is a
 * simple, direct operation rather than an always-identical-response one.
 * A no-op (not an error) if the address is already verified.
 */
export async function requestEmailVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) {
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });

  const now = new Date();
  const expiresAt = computeTokenExpiresAt(now, EMAIL_VERIFICATION_TOKEN_HOURS);
  const token = generateSecurityToken();
  const tokenHash = hashSecurityToken(token);

  const { mailDeliveryId, emailVerificationTokenId } = await prisma.$transaction(async (tx) => {
    await invalidateActiveEmailVerificationTokens(user.id, now, tx);
    const created = await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt }, tx);

    if (membership) {
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          userId: user.id,
          entityType: "User",
          entityId: user.id,
          action: AUDIT_ACTIONS.EMAIL_VERIFICATION_REQUESTED,
          metadata: {},
        },
      });
    }

    // §27 - atomic with the token row itself.
    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: membership?.organizationId,
        userId: user.id,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
        recipientHash: hashRecipient(user.email),
        idempotencyKey: buildEmailVerificationIdempotencyKey(created.id),
      },
      tx
    );

    return { mailDeliveryId: mailDelivery?.id, emailVerificationTokenId: created.id };
  });

  const verificationUrl = buildEmailVerificationUrl(process.env.APP_URL ?? "http://localhost:3000", token);

  if (mailDeliveryId) {
    try {
      await sendTrackedMail({
        mailDeliveryId,
        provider: getAccountSecurityMailerProviderLabel(),
        send: () =>
          getAccountSecurityMailer().sendEmailVerification({
            to: user.email,
            verificationUrl,
            expiresAt,
            emailVerificationTokenId,
          }),
      });
    } catch (error) {
      console.error(`Failed to send verification email to user ${user.id}:`, error);
    }
  }
}
