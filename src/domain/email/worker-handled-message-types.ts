import { TRANSACTIONAL_MESSAGE_TYPES, type TransactionalMessageType } from "./message-types";

/**
 * Phase 10B - message types the async `pnpm mail:process` worker is
 * allowed to claim and actually send. Deliberately just PASSWORD_CHANGED
 * today: the other three types (organization invitation / email
 * verification / password reset) carry a one-time plaintext token that is
 * never persisted anywhere (see schema.prisma's MailDelivery docstring),
 * so a separate worker process has no way to safely render them - those
 * are instead sent synchronously by the originating request and their
 * MailDelivery row is transitioned straight from PENDING to SENT/FAILED
 * inline (see server/services/invitations/real-invitation-mailer.ts and
 * server/services/account-security/real-account-security-mailer.ts).
 *
 * `claimNextPendingMailDelivery()` filters on this list at the SQL level -
 * not just as an application-level convention - so a token-bearing row
 * can never be raced/claimed by the worker even in the narrow window
 * between its own PENDING creation and the inline sender's own update.
 */
export const WORKER_HANDLED_MESSAGE_TYPES: readonly TransactionalMessageType[] = [
  TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED,
];
