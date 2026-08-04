import type { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";

import type { AuthContext } from "./auth-context";
import { requireOrganizationMembership } from "./require-organization-membership";
import { hasRequiredRole } from "./verify-membership";

export async function requireOrganizationRole(
  allowedRoles: MembershipRole | MembershipRole[],
  organizationId?: string
): Promise<AuthContext> {
  const context = await requireOrganizationMembership(organizationId);

  if (!hasRequiredRole(context.role, allowedRoles)) {
    throw new ForbiddenError();
  }

  return context;
}
