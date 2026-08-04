import { createHash } from "node:crypto";

/**
 * Phase 10B section 11 - `MailDelivery.recipientHash` stores this instead
 * of the recipient's actual address (section 11's "recipient 원문 이메일은
 * MailDelivery에 중복 저장하지 않는 것을 권장") - a one-way hash lets an
 * operator confirm "was mail X sent to the same address as mail Y"
 * without the delivery-tracking table itself becoming a second copy of
 * every user's email address. Lowercased before hashing so the same
 * address always hashes identically regardless of casing variance in how
 * it was typed at signup vs. invitation time.
 */
export function hashRecipient(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
