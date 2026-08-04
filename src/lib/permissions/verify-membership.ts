import type { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/lib/errors";

import type { AuthContext } from "./auth-context";

/**
 * The reusable "DB re-verification" core referenced by write-path callers.
 * Takes an explicit userId/organizationId - never trusts a JWT session's
 * role or organizationId claim - and re-queries the Membership table so a
 * forged/stale session value can never grant access to another
 * organization's data.
 *
 * Session-aware callers (see require-*.ts) resolve userId/organizationId
 * from the current session and delegate here. Other server code that
 * already has a validated userId/organizationId (e.g. a future contract
 * mutation) can call this directly without going through a session at all,
 * which also makes it trivial to unit/integration test without mocking
 * Auth.js.
 */
export async function verifyOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<AuthContext> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
  });

  if (!membership) {
    throw new ForbiddenError();
  }

  return { userId, organizationId, role: membership.role };
}

export function hasRequiredRole(
  role: MembershipRole,
  allowedRoles: MembershipRole | MembershipRole[]
): boolean {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return roles.includes(role);
}

export async function verifyOrganizationRole(
  userId: string,
  organizationId: string,
  allowedRoles: MembershipRole | MembershipRole[]
): Promise<AuthContext> {
  const context = await verifyOrganizationMembership(userId, organizationId);

  if (!hasRequiredRole(context.role, allowedRoles)) {
    throw new ForbiddenError();
  }

  return context;
}
