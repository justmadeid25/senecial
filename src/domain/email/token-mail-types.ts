import { TRANSACTIONAL_MESSAGE_TYPES, type TransactionalMessageType } from "./message-types";

/**
 * Phase 10C - the three message types whose MailDelivery row carries a
 * one-time plaintext token that is never persisted anywhere (see
 * schema.prisma's MailDelivery docstring) and is therefore sent
 * synchronously by the originating request rather than the async worker
 * (see worker-handled-message-types.ts). If the process dies after the DB
 * transaction that creates the row commits but before the synchronous send
 * call runs, the row is left PENDING forever - no worker will ever claim
 * it (WORKER_HANDLED_MESSAGE_TYPES structurally excludes these types), and
 * the original token is unrecoverable. scan/recover-stale-token-deliveries
 * detect and resolve exactly this stuck state.
 */
export const TOKEN_MAIL_MESSAGE_TYPES: readonly TransactionalMessageType[] = [
  TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
  TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
  TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
];

export function isTokenMailMessageType(messageType: string): boolean {
  return (TOKEN_MAIL_MESSAGE_TYPES as readonly string[]).includes(messageType);
}
