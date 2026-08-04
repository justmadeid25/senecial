import { MAIL_ERROR_CODES, isRetryableMailError } from "@/domain/email/mail-error-codes";
import {
  findStaleSendingMailDeliveries,
  markMailDeliveryFailed,
  resetMailDeliveryToPending,
} from "@/server/repositories/mail-delivery-repository";

export interface RecoverStaleMailDeliveriesResult {
  scanned: number;
  recoveredToPending: number;
  failed: number;
}

const DEFAULT_STALE_MINUTES = 15;

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/recover-stale-mail-deliveries.ts), mirroring
 * recover-stale-extraction-jobs.ts exactly. A SENDING row whose lock is
 * older than the stale threshold is presumed to have lost its worker
 * mid-send - if it still has retry budget it goes back to PENDING,
 * otherwise it is marked FAILED with MAX_ATTEMPTS_REACHED.
 */
export async function recoverStaleMailDeliveries(
  staleMinutes: number = DEFAULT_STALE_MINUTES
): Promise<RecoverStaleMailDeliveriesResult> {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const staleDeliveries = await findStaleSendingMailDeliveries(staleBefore);

  let recoveredToPending = 0;
  let failed = 0;

  for (const delivery of staleDeliveries) {
    if (isRetryableMailError(delivery.errorCode ?? "", delivery.attempt, delivery.maxAttempts)) {
      await resetMailDeliveryToPending(delivery.id);
      recoveredToPending += 1;
    } else {
      await markMailDeliveryFailed(delivery.id, {
        errorCode: MAIL_ERROR_CODES.MAX_ATTEMPTS_REACHED,
        errorMessage: "정체된 전송을 복구하지 못했습니다 (최대 재시도 횟수 초과).",
        provider: delivery.provider ?? undefined,
      });
      failed += 1;
    }
  }

  return { scanned: staleDeliveries.length, recoveredToPending, failed };
}
