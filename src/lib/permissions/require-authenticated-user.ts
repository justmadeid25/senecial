import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

export interface AuthenticatedSession {
  userId: string;
  sessionOrganizationId: string;
}

/**
 * Confirms a valid Auth.js session exists AND that its embedded
 * sessionVersion still matches the live User row (§22) - a JWT is
 * otherwise self-contained and has no server-side revocation, so this one
 * extra DB read per authenticated request is what makes a password reset
 * actually invalidate a stolen/still-cached session rather than just the
 * password itself. Mirrors this codebase's existing "always DB re-verify,
 * never trust the JWT claim alone" convention (see
 * verify-membership.ts's verifyOrganizationMembership()).
 *
 * Does not verify organization membership - see
 * requireOrganizationMembership() for that.
 */
export async function requireAuthenticatedUser(): Promise<AuthenticatedSession> {
  const session = await auth();
  const userId = session?.user?.id;
  const sessionOrganizationId = session?.user?.organizationId;
  const sessionVersion = session?.user?.sessionVersion;

  if (!userId || !sessionOrganizationId || sessionVersion === undefined) {
    throw new UnauthorizedError();
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== sessionVersion) {
    throw new UnauthorizedError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }

  return { userId, sessionOrganizationId };
}
