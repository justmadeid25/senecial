import { MembershipRole } from "@/generated/prisma/enums";

import type { AuthContext } from "./auth-context";
import { requireOrganizationRole } from "./require-organization-role";

export async function requireOwner(organizationId?: string): Promise<AuthContext> {
  return requireOrganizationRole(MembershipRole.OWNER, organizationId);
}
