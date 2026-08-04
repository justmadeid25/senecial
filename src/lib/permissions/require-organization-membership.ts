import type { AuthContext } from "./auth-context";
import { requireAuthenticatedUser } from "./require-authenticated-user";
import { verifyOrganizationMembership } from "./verify-membership";

/**
 * Session-aware wrapper: resolves the current user and (by default) their
 * session's organizationId, then re-verifies membership against the
 * database. The session's organizationId is only used to pick *which*
 * organization to check - the actual authorization decision always comes
 * from the DB query in verifyOrganizationMembership(), so a forged/stale
 * JWT claim cannot grant access.
 */
export async function requireOrganizationMembership(
  organizationId?: string
): Promise<AuthContext> {
  const { userId, sessionOrganizationId } = await requireAuthenticatedUser();
  const targetOrganizationId = organizationId ?? sessionOrganizationId;

  return verifyOrganizationMembership(userId, targetOrganizationId);
}
