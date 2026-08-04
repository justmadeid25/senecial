/**
 * Phase 10B §4 - the four transactional message categories this app sends.
 * Stored as plain strings (not a Prisma enum) on `MailDelivery.messageType`
 * for the same reason `BatchExecution.jobName` and `AuditLog.action` are
 * plain strings elsewhere in this codebase - adding a new message type
 * later never requires a migration.
 */
export const TRANSACTIONAL_MESSAGE_TYPES = {
  ORGANIZATION_INVITATION: "ORGANIZATION_INVITATION",
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
} as const;

export type TransactionalMessageType =
  (typeof TRANSACTIONAL_MESSAGE_TYPES)[keyof typeof TRANSACTIONAL_MESSAGE_TYPES];
