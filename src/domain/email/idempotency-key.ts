/**
 * Phase 10B section 14 - deterministic idempotency keys, one per
 * real-world event (never per HTTP request/attempt) so a retried request
 * handler (or a rare double-submit) can never create two MailDelivery rows
 * for the same underlying event - the DB's `@@unique(idempotencyKey)`
 * constraint is the actual enforcement point; these builders just make
 * sure every call site derives the same string for the same event.
 */
export function buildInvitationIdempotencyKey(invitationId: string): string {
  return `organization-invitation:${invitationId}`;
}

/**
 * Section 19 - a resend rotates the invitation's token (never re-sends
 * the old one) but keeps the same invitationId, so the plain
 * `buildInvitationIdempotencyKey()` key would collide with the original
 * send's MailDelivery row. Keying on `resendCount` (incremented
 * atomically by rotateInvitationToken()) gives each distinct resend event
 * its own key while still deduplicating a transaction-level retry of the
 * *same* resend attempt (which would recompute the same resendCount).
 */
export function buildInvitationResendIdempotencyKey(invitationId: string, resendCount: number): string {
  return `organization-invitation:${invitationId}:resend:${resendCount}`;
}

export function buildEmailVerificationIdempotencyKey(emailVerificationTokenId: string): string {
  return `email-verification:${emailVerificationTokenId}`;
}

export function buildPasswordResetIdempotencyKey(passwordResetTokenId: string): string {
  return `password-reset:${passwordResetTokenId}`;
}

/**
 * Keyed on (userId, sessionVersion) rather than a row id - `sessionVersion`
 * is incremented exactly once per password change (see reset-password.ts),
 * so this is already a stable, unique-per-event identifier without needing
 * a dedicated token/row of its own.
 */
export function buildPasswordChangedIdempotencyKey(userId: string, sessionVersion: number): string {
  return `password-changed:${userId}:${sessionVersion}`;
}

/**
 * Phase 10C - the inverse of buildInvitationIdempotencyKey() /
 * buildInvitationResendIdempotencyKey() / buildEmailVerificationIdempotencyKey() /
 * buildPasswordResetIdempotencyKey(): recovers the entity id (invitation id
 * or token row id) a stale token-bearing MailDelivery row was created for,
 * so recover-stale-token-deliveries.ts can look up that row without needing
 * a direct foreign key on MailDelivery itself. Every one of those builders
 * puts the entity id as the second colon-separated segment, so this is a
 * single shared parse regardless of which of the three prefixes matched -
 * a resend's extra `:resend:{n}` suffix is simply ignored (the id segment
 * never changes across resends of the same invitation).
 */
export function parseTokenMailEntityId(idempotencyKey: string): string | null {
  const segments = idempotencyKey.split(":");
  return segments[1] || null;
}
