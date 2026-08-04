export const INVITATION_EXPIRY_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeInvitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_EXPIRY_DAYS * MS_PER_DAY);
}

/** Expiry is inclusive of the exact instant - "expiresAt" itself is already expired. */
export function isInvitationExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
