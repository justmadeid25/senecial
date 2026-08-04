import type { MembershipRole } from "@/generated/prisma/enums";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findMembershipsByOrganization } from "@/server/repositories/membership-repository";

export interface MemberListItem {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: Date;
}

export interface ListMembersParams {
  userId: string;
  organizationId: string;
}

/**
 * OWNER and MEMBER can both view the member list (product decision - see
 * README). Only mutation (invite/role change/removal) is OWNER-only.
 */
export async function listMembers(params: ListMembersParams): Promise<MemberListItem[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const memberships = await findMembershipsByOrganization(authContext.organizationId);

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    joinedAt: membership.createdAt,
  }));
}
