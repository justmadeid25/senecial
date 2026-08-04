import { MAIL_ERROR_CODES } from "@/domain/email/mail-error-codes";
import {
  buildEmailVerificationIdempotencyKey,
  buildInvitationResendIdempotencyKey,
  parseTokenMailEntityId,
} from "@/domain/email/idempotency-key";
import { computeTokenExpiresAt } from "@/domain/account-security/token-expiry";
import { buildEmailVerificationUrl } from "@/domain/account-security/urls";
import { computeInvitationExpiresAt } from "@/domain/invitations/invitation-expiry";
import { buildInvitationUrl } from "@/domain/invitations/invitation-url";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { EMAIL_VERIFICATION_TOKEN_HOURS } from "@/lib/config/account-security";
import { deliverInvitationMail } from "@/features/members/server/deliver-invitation-mail";
import { generateSecurityToken, hashSecurityToken } from "@/server/auth/security-token";
import { generateInvitationToken, hashInvitationToken } from "@/server/auth/invitation-token";
import { prisma } from "@/server/db/client";
import type { MailDeliveryRow } from "@/server/repositories/mail-delivery-repository";
import {
  enqueuePendingMailDelivery,
  findStalePendingTokenDeliveries,
  markMailDeliveryCancelledIfPending,
} from "@/server/repositories/mail-delivery-repository";
import {
  createEmailVerificationToken,
  findEmailVerificationTokenById,
  invalidateActiveEmailVerificationTokens,
} from "@/server/repositories/email-verification-token-repository";
import { findInvitationById, rotateInvitationToken } from "@/server/repositories/invitation-repository";
import { getAccountSecurityMailer, getAccountSecurityMailerProviderLabel } from "@/server/services/account-security";
import { sendTrackedMail } from "@/server/services/email/send-tracked-mail";

import { DEFAULT_STALE_TOKEN_MAIL_MINUTES } from "./scan-stale-token-deliveries";

export interface RecoverStaleTokenDeliveriesParams {
  staleMinutes?: number;
  limit?: number;
  dryRun: boolean;
}

export interface RecoverStaleTokenDeliveriesResult {
  scanned: number;
  invitationsRotated: number;
  verificationsRotated: number;
  passwordResetsFlagged: number;
  skipped: number;
  errors: number;
}

const UNRECOVERABLE_ERROR_MESSAGE =
  "정체된 토큰 메일 - 연결된 정보를 찾을 수 없거나 이미 완료/취소되어 재발급하지 않고 취소되었습니다.";

/**
 * Phase 10C section 10 - resolves every stale, still-PENDING token-bearing
 * MailDelivery row (scan-stale-token-deliveries.ts's write counterpart).
 * Never attempts to recover the original plaintext token (it was never
 * persisted - see schema.prisma's MailDelivery docstring); instead:
 *
 * - ORGANIZATION_INVITATION / EMAIL_VERIFICATION: rotates to a brand new
 *   token (same "invalidate old, issue new" shape as resend-invitation.ts/
 *   request-email-verification.ts) and sends it, then cancels the stale row.
 * - PASSWORD_RESET: never auto-reissues (would let an attacker probe which
 *   email addresses have accounts, and would send a surprise reset email a
 *   user did not just ask for) - only flags the stale row CANCELLED so an
 *   operator/monitoring system can see it; the user must submit a fresh
 *   "이메일/비밀번호를 잊으셨나요" request themselves for a new token.
 *
 * Every write is guarded by markMailDeliveryCancelledIfPending()'s
 * conditional `status: PENDING` update, so two concurrent recovery runs (or
 * a recovery run racing the original inline sender finally waking up) can
 * never double-process the same row - whichever one flips PENDING first
 * wins, the other sees `false` and treats the row as already handled.
 */
export async function recoverStaleTokenDeliveries(
  params: RecoverStaleTokenDeliveriesParams
): Promise<RecoverStaleTokenDeliveriesResult> {
  const staleMinutes = params.staleMinutes ?? DEFAULT_STALE_TOKEN_MAIL_MINUTES;
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const stale = await findStalePendingTokenDeliveries(staleBefore);
  const targeted = params.limit !== undefined ? stale.slice(0, params.limit) : stale;

  let invitationsRotated = 0;
  let verificationsRotated = 0;
  let passwordResetsFlagged = 0;
  let skipped = 0;
  let errors = 0;

  for (const delivery of targeted) {
    try {
      let recovered = false;
      switch (delivery.messageType) {
        case TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION:
          recovered = await recoverInvitationDelivery(delivery, params.dryRun);
          if (recovered) invitationsRotated += 1;
          break;
        case TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION:
          recovered = await recoverVerificationDelivery(delivery, params.dryRun);
          if (recovered) verificationsRotated += 1;
          break;
        case TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET:
          recovered = await flagPasswordResetDelivery(delivery, params.dryRun);
          if (recovered) passwordResetsFlagged += 1;
          break;
        default:
          break;
      }
      if (!recovered) {
        skipped += 1;
      }
    } catch (error) {
      console.error(
        `정체 토큰 메일 복구 중 오류 (id=${delivery.id}, messageType=${delivery.messageType}):`,
        error instanceof Error ? error.message : error
      );
      errors += 1;
    }
  }

  return { scanned: targeted.length, invitationsRotated, verificationsRotated, passwordResetsFlagged, skipped, errors };
}

async function recoverInvitationDelivery(delivery: MailDeliveryRow, dryRun: boolean): Promise<boolean> {
  const invitationId = parseTokenMailEntityId(delivery.idempotencyKey);
  if (!invitationId || !delivery.organizationId) {
    if (!dryRun) {
      await markMailDeliveryCancelledIfPending(delivery.id, {
        errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
        errorMessage: UNRECOVERABLE_ERROR_MESSAGE,
      });
    }
    return false;
  }

  const invitation = await findInvitationById({ organizationId: delivery.organizationId, invitationId });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    if (!dryRun) {
      await markMailDeliveryCancelledIfPending(delivery.id, {
        errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
        errorMessage: UNRECOVERABLE_ERROR_MESSAGE,
      });
    }
    return false;
  }

  if (dryRun) {
    return true;
  }

  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = computeInvitationExpiresAt(new Date());

  const outcome = await prisma.$transaction(async (tx) => {
    const cancelled = await markMailDeliveryCancelledIfPending(
      delivery.id,
      { errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED, errorMessage: "정체된 초대 메일 - 새 토큰으로 재발급되어 취소되었습니다." },
      tx
    );
    if (!cancelled) {
      return null;
    }

    const rotated = await rotateInvitationToken(
      { organizationId: invitation.organizationId, invitationId: invitation.id, tokenHash, expiresAt },
      tx
    );
    if (!rotated) {
      return null;
    }

    await tx.auditLog.create({
      data: {
        organizationId: invitation.organizationId,
        userId: invitation.invitedById,
        entityType: "OrganizationInvitation",
        entityId: rotated.id,
        action: AUDIT_ACTIONS.STALE_TOKEN_MAIL_INVITATION_RECOVERED,
        metadata: { invitationId: rotated.id, staleMailDeliveryId: delivery.id, resendCount: rotated.resendCount },
      },
    });

    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: invitation.organizationId,
        userId: invitation.invitedById,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
        recipientHash: hashRecipient(rotated.email),
        idempotencyKey: buildInvitationResendIdempotencyKey(rotated.id, rotated.resendCount),
      },
      tx
    );

    return { rotated, mailDeliveryId: mailDelivery?.id };
  });

  if (!outcome) {
    return false;
  }

  if (outcome.mailDeliveryId) {
    const [inviter, organization] = await Promise.all([
      prisma.user.findUnique({ where: { id: invitation.invitedById }, select: { name: true } }),
      prisma.organization.findUnique({ where: { id: invitation.organizationId }, select: { name: true } }),
    ]);
    if (inviter && organization) {
      const invitationUrl = buildInvitationUrl(process.env.APP_URL ?? "http://localhost:3000", token);
      await deliverInvitationMail({
        mailDeliveryId: outcome.mailDeliveryId,
        email: outcome.rotated.email,
        organizationName: organization.name,
        inviterName: inviter.name,
        invitationUrl,
        expiresAt,
        role: outcome.rotated.role,
        invitationId: outcome.rotated.id,
      });
    }
  }

  return true;
}

async function recoverVerificationDelivery(delivery: MailDeliveryRow, dryRun: boolean): Promise<boolean> {
  const tokenId = parseTokenMailEntityId(delivery.idempotencyKey);
  if (!tokenId || !delivery.userId) {
    if (!dryRun) {
      await markMailDeliveryCancelledIfPending(delivery.id, {
        errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
        errorMessage: UNRECOVERABLE_ERROR_MESSAGE,
      });
    }
    return false;
  }

  const [token, user] = await Promise.all([
    findEmailVerificationTokenById(tokenId),
    prisma.user.findUnique({ where: { id: delivery.userId }, select: { id: true, email: true, emailVerifiedAt: true } }),
  ]);

  if (!token || !user || user.emailVerifiedAt || token.usedAt) {
    if (!dryRun) {
      await markMailDeliveryCancelledIfPending(delivery.id, {
        errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
        errorMessage: UNRECOVERABLE_ERROR_MESSAGE,
      });
    }
    return false;
  }

  if (dryRun) {
    return true;
  }

  const now = new Date();
  const newToken = generateSecurityToken();
  const tokenHash = hashSecurityToken(newToken);
  const expiresAt = computeTokenExpiresAt(now, EMAIL_VERIFICATION_TOKEN_HOURS);

  const outcome = await prisma.$transaction(async (tx) => {
    const cancelled = await markMailDeliveryCancelledIfPending(
      delivery.id,
      { errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED, errorMessage: "정체된 이메일 인증 메일 - 새 토큰으로 재발급되어 취소되었습니다." },
      tx
    );
    if (!cancelled) {
      return null;
    }

    await invalidateActiveEmailVerificationTokens(user.id, now, tx);
    const created = await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt }, tx);

    if (delivery.organizationId) {
      await tx.auditLog.create({
        data: {
          organizationId: delivery.organizationId,
          userId: user.id,
          entityType: "User",
          entityId: user.id,
          action: AUDIT_ACTIONS.STALE_TOKEN_MAIL_VERIFICATION_RECOVERED,
          metadata: { emailVerificationTokenId: created.id, staleMailDeliveryId: delivery.id },
        },
      });
    }

    const mailDelivery = await enqueuePendingMailDelivery(
      {
        organizationId: delivery.organizationId ?? undefined,
        userId: user.id,
        messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
        recipientHash: hashRecipient(user.email),
        idempotencyKey: buildEmailVerificationIdempotencyKey(created.id),
      },
      tx
    );

    return { mailDeliveryId: mailDelivery?.id, emailVerificationTokenId: created.id };
  });

  if (!outcome) {
    return false;
  }

  if (outcome.mailDeliveryId) {
    const verificationUrl = buildEmailVerificationUrl(process.env.APP_URL ?? "http://localhost:3000", newToken);
    try {
      await sendTrackedMail({
        mailDeliveryId: outcome.mailDeliveryId,
        provider: getAccountSecurityMailerProviderLabel(),
        send: () =>
          getAccountSecurityMailer().sendEmailVerification({
            to: user.email,
            verificationUrl,
            expiresAt,
            emailVerificationTokenId: outcome.emailVerificationTokenId,
          }),
      });
    } catch (error) {
      console.error(`Failed to send recovered verification email for user ${user.id}:`, error);
    }
  }

  return true;
}

/**
 * §10 - deliberately does NOT look up or touch PasswordResetToken at all:
 * no new token is minted here under any circumstance. Only the stale
 * MailDelivery row itself is cancelled (flagged TOKEN_REISSUE_REQUIRED) so
 * an operator/monitoring dashboard can see it happened; the account owner
 * must submit their own new "비밀번호를 잊으셨나요" request to get a working link.
 */
async function flagPasswordResetDelivery(delivery: MailDeliveryRow, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    return true;
  }

  const cancelled = await markMailDeliveryCancelledIfPending(delivery.id, {
    errorCode: MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED,
    errorMessage: "정체된 비밀번호 재설정 메일 - 자동 재발송하지 않습니다. 사용자의 새 요청으로만 재발급됩니다.",
  });
  if (!cancelled) {
    return false;
  }

  if (delivery.organizationId) {
    await prisma.auditLog.create({
      data: {
        organizationId: delivery.organizationId,
        userId: delivery.userId,
        entityType: "MailDelivery",
        entityId: delivery.id,
        action: AUDIT_ACTIONS.STALE_TOKEN_MAIL_PASSWORD_RESET_FLAGGED,
        metadata: { staleMailDeliveryId: delivery.id },
      },
    });
  }

  return true;
}
