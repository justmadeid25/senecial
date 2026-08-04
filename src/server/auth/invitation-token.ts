import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32; // 256 bits of entropy

/**
 * Generates a cryptographically secure, URL-safe invitation token. This
 * plaintext value is only ever held transiently (embedded in the
 * invitation URL, passed to the mailer) - it is never persisted. Only its
 * hash (see hashInvitationToken) is stored in OrganizationInvitation.
 */
export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * One-way SHA-256 hash of an invitation token. A leaked database (without
 * the original URLs, e.g. from a backup) cannot be used to derive working
 * invitation links.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
