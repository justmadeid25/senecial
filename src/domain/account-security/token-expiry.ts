const MS_PER_HOUR = 60 * 60 * 1000;

export function computeTokenExpiresAt(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * MS_PER_HOUR);
}

/** Expiry is inclusive of the exact instant - matches invitation-expiry.ts's isInvitationExpired(). */
export function isTokenExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export interface SecurityTokenState {
  expiresAt: Date;
  usedAt: Date | null;
}

/** A token is usable exactly once, and only before it expires. */
export function isTokenUsable(token: SecurityTokenState, now: Date): boolean {
  return token.usedAt === null && !isTokenExpired(token.expiresAt, now);
}
