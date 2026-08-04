import type { MembershipRole } from "@/generated/prisma/enums";

/**
 * The identity + organization scope a server operation is authorized to act
 * as. Always sourced from a DB-verified Membership row, never taken as-is
 * from the JWT session - see verify-membership.ts.
 */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: MembershipRole;
}
