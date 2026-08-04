import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32; // 256 bits of entropy

/**
 * Generic version of invitation-token.ts's generate/hash pair, used for
 * EmailVerificationToken/PasswordResetToken - same "never store the
 * plaintext" rationale applies (see invitation-token.ts's docstrings).
 */
export function generateSecurityToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSecurityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
