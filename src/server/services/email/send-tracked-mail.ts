import { recordDependencyLatency } from "@/server/monitoring/metrics";
import {
  markMailDeliveryFailed,
  markMailDeliverySending,
  markMailDeliverySent,
} from "@/server/repositories/mail-delivery-repository";

import { classifyMailSendError } from "./mail-provider-error";

/**
 * Phase 10B sections 12/14/27 - the shared "attempt an inline (non-worker)
 * send and transition the already-created MailDelivery row" wrapper used
 * by the three token-bearing call sites (create-invitation.ts,
 * request-email-verification.ts, request-password-reset.ts). The
 * MailDelivery row itself must already exist (created PENDING inside the
 * originating DB transaction, atomically with the invitation/token row -
 * see mail-delivery-repository.ts's enqueuePendingMailDelivery()) BEFORE
 * this is called; this function only ever transitions it.
 *
 * Re-throws on failure (after recording it) so the caller's existing
 * try/catch + `console.error` best-effort logging is unaffected - a mail
 * failure must never surface as an error to the end user for these flows
 * (unchanged from Phase 9).
 */
export async function sendTrackedMail(params: {
  mailDeliveryId: string;
  provider: string;
  send: () => Promise<{ providerMessageId?: string } | void>;
}): Promise<void> {
  await markMailDeliverySending(params.mailDeliveryId);
  const start = performance.now();
  try {
    const result = await params.send();
    await markMailDeliverySent(params.mailDeliveryId, {
      provider: params.provider,
      providerMessageId: result?.providerMessageId,
    });
  } catch (error) {
    const { errorCode, errorMessage } = classifyMailSendError(error);
    await markMailDeliveryFailed(params.mailDeliveryId, { errorCode, errorMessage, provider: params.provider });
    throw error;
  } finally {
    // Phase 11 §Monitoring - every send this app makes (worker-claimed or
    // inline/synchronous - see mail-delivery-repository.ts) goes through
    // this one function, so this single call site covers the mail
    // latency metric regardless of provider or message type.
    recordDependencyLatency("mail", performance.now() - start);
  }
}
