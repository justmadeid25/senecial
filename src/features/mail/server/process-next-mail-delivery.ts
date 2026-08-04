import { MAIL_ERROR_CODES, isRetryableMailError } from "@/domain/email/mail-error-codes";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { computeMailRetryBackoffMs } from "@/domain/email/retry-backoff";
import { prisma } from "@/server/db/client";
import {
  claimNextPendingMailDelivery,
  markMailDeliveryFailed,
  markMailDeliveryRetrying,
  markMailDeliverySent,
} from "@/server/repositories/mail-delivery-repository";
import { getAccountSecurityMailer, getAccountSecurityMailerProviderLabel } from "@/server/services/account-security";
import { classifyMailSendError, MailProviderError } from "@/server/services/email/mail-provider-error";

export interface ProcessNextMailDeliveryResult {
  processed: boolean;
  mailDeliveryId?: string;
  outcome?: "sent" | "retrying" | "failed";
}

/**
 * Phase 10B section 13 - claims one PENDING MailDelivery via `FOR UPDATE
 * SKIP LOCKED` (claimNextPendingMailDelivery(), scoped to worker-handled
 * message types only - see worker-handled-message-types.ts) and attempts
 * to send it. Currently only PASSWORD_CHANGED ever reaches here (the
 * other three message types are sent inline by their originating request
 * - see send-tracked-mail.ts); the `default` branch below is defensive
 * insurance against a future message type being added to
 * WORKER_HANDLED_MESSAGE_TYPES without a matching case here, not
 * something that can happen with the current three.
 */
export async function processNextMailDelivery(workerId: string): Promise<ProcessNextMailDeliveryResult> {
  const claimed = await claimNextPendingMailDelivery(workerId);
  if (!claimed) {
    return { processed: false };
  }

  const provider = getAccountSecurityMailerProviderLabel();

  try {
    switch (claimed.messageType) {
      case TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED: {
        await sendPasswordChangedNotice(claimed.userId, claimed.idempotencyKey);
        break;
      }
      default: {
        // Defensive only - see docstring above.
        await markMailDeliveryFailed(claimed.id, {
          errorCode: MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE,
          errorMessage: `이 워커가 처리할 수 없는 메일 유형입니다: ${claimed.messageType}`,
          provider,
        });
        return { processed: true, mailDeliveryId: claimed.id, outcome: "failed" };
      }
    }

    await markMailDeliverySent(claimed.id, { provider });
    return { processed: true, mailDeliveryId: claimed.id, outcome: "sent" };
  } catch (error) {
    const { errorCode, errorMessage } = classifyMailSendError(error);

    if (isRetryableMailError(errorCode, claimed.attempt, claimed.maxAttempts)) {
      await markMailDeliveryRetrying(claimed.id, {
        scheduledFor: new Date(Date.now() + computeMailRetryBackoffMs(claimed.attempt)),
        errorCode,
        errorMessage,
        provider,
      });
      return { processed: true, mailDeliveryId: claimed.id, outcome: "retrying" };
    }

    const finalErrorCode = claimed.attempt >= claimed.maxAttempts ? MAIL_ERROR_CODES.MAX_ATTEMPTS_REACHED : errorCode;
    await markMailDeliveryFailed(claimed.id, { errorCode: finalErrorCode, errorMessage, provider });
    return { processed: true, mailDeliveryId: claimed.id, outcome: "failed" };
  }
}

async function sendPasswordChangedNotice(userId: string | null, idempotencyKey: string): Promise<void> {
  if (!userId) {
    throw new MailProviderError(MAIL_ERROR_CODES.INVALID_RECIPIENT, "MailDelivery row is missing userId");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) {
    // §16 - the account no longer exists (deleted since this was enqueued) - not retryable, and INVALID_RECIPIENT is the closest existing safe code (no working recipient to deliver to).
    throw new MailProviderError(MAIL_ERROR_CODES.INVALID_RECIPIENT, "recipient no longer exists");
  }

  await getAccountSecurityMailer().sendPasswordChangedNotice({ to: user.email, idempotencyKey });
}
