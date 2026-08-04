import { MailDeliveryStatus, Prisma, type PrismaClient } from "@/generated/prisma/client";
import { TOKEN_MAIL_MESSAGE_TYPES } from "@/domain/email/token-mail-types";
import { WORKER_HANDLED_MESSAGE_TYPES } from "@/domain/email/worker-handled-message-types";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type MailDeliveryRow = Prisma.MailDeliveryGetPayload<Record<string, never>>;

export interface EnqueuePendingMailDeliveryData {
  organizationId?: string;
  userId?: string;
  messageType: string;
  recipientHash: string;
  idempotencyKey: string;
}

/**
 * §11/§12/§27 - creates the MailDelivery row atomically alongside the
 * event that triggers it (the invitation/token row + AuditLog, inside the
 * same `$transaction`) for EVERY message type, token-bearing or not. What
 * differs by type is only what happens NEXT: PASSWORD_CHANGED stays
 * PENDING for the async worker to claim later; the three token-bearing
 * types are transitioned inline by the caller right after the transaction
 * commits (see real-invitation-mailer.ts / real-account-security-mailer.ts)
 * - never left PENDING for the generic worker, which structurally cannot
 * claim them (see worker-handled-message-types.ts).
 *
 * A duplicate idempotencyKey (a retried request handler re-running the
 * same event, or - inside a transaction - the same transaction retried by
 * Prisma after a serialization conflict) is a silent no-op, matching
 * run-batch-job.ts's identical "duplicate insert is safe" handling.
 */
export async function enqueuePendingMailDelivery(
  data: EnqueuePendingMailDeliveryData,
  client: DbClient = prisma
): Promise<MailDeliveryRow | null> {
  try {
    return await client.mailDelivery.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        messageType: data.messageType,
        recipientHash: data.recipientHash,
        idempotencyKey: data.idempotencyKey,
        status: MailDeliveryStatus.PENDING,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * §13 - owns its own transaction, mirroring
 * extraction-job-repository.ts's claimNextPendingJob() exactly: `FOR
 * UPDATE SKIP LOCKED` must be the first statement of its transaction and
 * the claiming UPDATE must run on the same connection, which only
 * Prisma's interactive `$transaction()` guarantees - a caller-supplied
 * client cannot be used here. Only claims rows whose `scheduledFor` has
 * already passed (the retry-backoff gate) AND whose messageType this
 * worker actually knows how to render (see worker-handled-message-types.ts)
 * - the SQL-level filter, not just an application convention, is what
 * makes it structurally impossible for this worker to race a
 * synchronously-sent token-bearing delivery.
 */
export async function claimNextPendingMailDelivery(workerId: string): Promise<MailDeliveryRow | null> {
  return prisma.$transaction(async (tx) => {
    const claimable = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "mail_deliveries"
      WHERE "status" = 'PENDING' AND "scheduledFor" <= now()
        AND "messageType" IN (${Prisma.join(WORKER_HANDLED_MESSAGE_TYPES)})
      ORDER BY "scheduledFor" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const claimedId = claimable[0]?.id;
    if (!claimedId) {
      return null;
    }

    return tx.mailDelivery.update({
      where: { id: claimedId },
      data: {
        status: MailDeliveryStatus.SENDING,
        attempt: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });
  });
}

/** Used by the inline (non-worker) senders - transitions PENDING straight to SENDING with attempt=1, no locking needed since no concurrent claimer can ever see a token-bearing row (see claimNextPendingMailDelivery's filter). */
export async function markMailDeliverySending(id: string, client: DbClient = prisma): Promise<void> {
  await client.mailDelivery.update({
    where: { id },
    data: { status: MailDeliveryStatus.SENDING, attempt: { increment: 1 } },
  });
}

export async function markMailDeliverySent(
  id: string,
  data: { providerMessageId?: string; provider: string },
  client: DbClient = prisma
): Promise<void> {
  await client.mailDelivery.update({
    where: { id },
    data: {
      status: MailDeliveryStatus.SENT,
      sentAt: new Date(),
      providerMessageId: data.providerMessageId,
      provider: data.provider,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/** §15 - a retryable failure stays PENDING with `scheduledFor` pushed forward - never FAILED. Only ever used by the worker path (token-bearing/inline sends go straight to markMailDeliveryFailed on any failure - see worker-handled-message-types.ts's docstring for why they never retry in the background). */
export async function markMailDeliveryRetrying(
  id: string,
  data: { scheduledFor: Date; errorCode: string; errorMessage: string; provider: string },
  client: DbClient = prisma
): Promise<void> {
  await client.mailDelivery.update({
    where: { id },
    data: {
      status: MailDeliveryStatus.PENDING,
      scheduledFor: data.scheduledFor,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      provider: data.provider,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function markMailDeliveryFailed(
  id: string,
  data: { errorCode: string; errorMessage: string; provider?: string },
  client: DbClient = prisma
): Promise<void> {
  await client.mailDelivery.update({
    where: { id },
    data: {
      status: MailDeliveryStatus.FAILED,
      failedAt: new Date(),
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      provider: data.provider,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/** §13 stale recovery - a SENDING row whose lock is older than the threshold is presumed to have lost its worker mid-send, mirroring recover-stale-extraction-jobs.ts. Scoped to worker-handled types for the same reason claimNextPendingMailDelivery() is - an inline sender's own SENDING row is never left dangling long enough to matter (it transitions within the same request), but the filter keeps this function's contract honest regardless. */
export async function findStaleSendingMailDeliveries(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<MailDeliveryRow[]> {
  return client.mailDelivery.findMany({
    where: {
      status: MailDeliveryStatus.SENDING,
      lockedAt: { lt: staleBefore },
      messageType: { in: [...WORKER_HANDLED_MESSAGE_TYPES] },
    },
  });
}

export async function resetMailDeliveryToPending(id: string, client: DbClient = prisma): Promise<MailDeliveryRow> {
  return client.mailDelivery.update({
    where: { id },
    data: { status: MailDeliveryStatus.PENDING, scheduledFor: new Date(), lockedAt: null, lockedBy: null },
  });
}

/**
 * Phase 10C - a token-bearing MailDelivery row (see token-mail-types.ts)
 * left PENDING past the stale threshold: the synchronous inline sender
 * that should have transitioned it to SENDING/SENT/FAILED never ran (the
 * process died right after the DB transaction that created it committed).
 * No worker will ever claim it - WORKER_HANDLED_MESSAGE_TYPES structurally
 * excludes these types (see claimNextPendingMailDelivery()) - so it can
 * only be resolved by scan/recover-stale-token-deliveries.
 */
export async function findStalePendingTokenDeliveries(
  staleBefore: Date,
  client: DbClient = prisma
): Promise<MailDeliveryRow[]> {
  return client.mailDelivery.findMany({
    where: {
      status: MailDeliveryStatus.PENDING,
      createdAt: { lt: staleBefore },
      messageType: { in: [...TOKEN_MAIL_MESSAGE_TYPES] },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Phase 10C - the guarded first step of stale-token-mail recovery: only
 * transitions a row that is STILL PENDING (an `updateMany` with `status:
 * PENDING` in its `where`, re-checked at write time, not just read time -
 * same "recheck at write" shape as rotateInvitationToken()). Returns false
 * if another process already recovered (or otherwise transitioned) this
 * row first, which the caller must treat as "skip this row, do not also
 * rotate its token" - this is what makes concurrent recovery runs safe
 * against double-processing the same stale row.
 */
export async function markMailDeliveryCancelledIfPending(
  id: string,
  data: { errorCode: string; errorMessage: string },
  client: DbClient = prisma
): Promise<boolean> {
  const result = await client.mailDelivery.updateMany({
    where: { id, status: MailDeliveryStatus.PENDING },
    data: {
      status: MailDeliveryStatus.CANCELLED,
      failedAt: new Date(),
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });
  return result.count > 0;
}
