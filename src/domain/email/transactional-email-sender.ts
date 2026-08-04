import type { TransactionalMessageType } from "./message-types";

/**
 * Provider-side tagging only - e.g. Postmark's `Metadata` field, used for
 * operational filtering in the provider's own dashboard. Never put a
 * token, password, or full recipient address here (§7/§16) - only safe,
 * already-non-sensitive identifiers like `messageType` or an internal id.
 */
export type SafeEmailMetadata = Record<string, string>;

export interface TransactionalEmailSendInput {
  messageType: TransactionalMessageType;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Passed through to the provider's own idempotency/dedup mechanism when supported (see PostmarkTransactionalMailer) - the DB-level unique key on MailDelivery.idempotencyKey is still the primary, always-enforced guard (§14). */
  idempotencyKey: string;
  metadata?: SafeEmailMetadata;
}

export interface EmailSendResult {
  /** Internal operational tracking only - never surfaced to end users (§3). */
  providerMessageId?: string;
  accepted: boolean;
}

/**
 * §3 - the single low-level transport interface every real provider
 * implementation (PostmarkTransactionalMailer, and any future
 * Ses/Resend/SendGrid driver) implements. No provider-specific type
 * (Postmark's `Message`, AWS SDK's `SendEmailCommand`, ...) is ever
 * exposed outside `server/services/email` - callers only see this shape.
 */
export interface TransactionalEmailSender {
  send(input: TransactionalEmailSendInput): Promise<EmailSendResult>;
}
