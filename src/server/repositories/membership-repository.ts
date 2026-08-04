import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const withUser = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MembershipInclude;

export type MembershipWithUser = Prisma.MembershipGetPayload<{ include: typeof withUser }>;

/**
 * Every function below requires organizationId as an explicit argument and
 * always merges it into the query's where clause *last* - mirrors
 * contract-repository.ts / counterparty-repository.ts / contract-file-
 * repository.ts, so org isolation is structurally impossible to bypass.
 */

export async function findMembershipsByOrganization(
  organizationId: string,
  client: DbClient = prisma
): Promise<MembershipWithUser[]> {
  return client.membership.findMany({
    where: { organizationId },
    include: withUser,
    orderBy: { createdAt: "asc" },
  });
}

export async function findMembershipById(
  params: { organizationId: string; membershipId: string },
  client: DbClient = prisma
): Promise<MembershipWithUser | null> {
  return client.membership.findFirst({
    where: { id: params.membershipId, organizationId: params.organizationId },
    include: withUser,
  });
}

export async function findMembershipByUserAndOrganization(
  params: { organizationId: string; userId: string },
  client: DbClient = prisma
) {
  return client.membership.findUnique({
    where: {
      userId_organizationId: { userId: params.userId, organizationId: params.organizationId },
    },
  });
}

export async function countOwners(
  organizationId: string,
  client: DbClient = prisma
): Promise<number> {
  return client.membership.count({
    where: { organizationId, role: MembershipRole.OWNER },
  });
}

/**
 * Scoped updateMany, matching the rest of the codebase's write pattern -
 * returns the updated row (with user info) or null if nothing matched
 * (wrong org, or membership does not exist).
 */
export async function updateMembershipRole(
  params: { organizationId: string; membershipId: string; role: MembershipRole },
  client: DbClient = prisma
): Promise<MembershipWithUser | null> {
  const result = await client.membership.updateMany({
    where: { id: params.membershipId, organizationId: params.organizationId },
    data: { role: params.role },
  });

  if (result.count === 0) {
    return null;
  }

  return findMembershipById(
    { organizationId: params.organizationId, membershipId: params.membershipId },
    client
  );
}

/**
 * Hard delete (Membership has no deletedAt - see README's "구성원 제거"
 * policy note). Returns the row as it existed just before deletion (with
 * user info) so the caller can still build an AuditLog entry and success
 * message after the row is gone, or null if it never matched this org.
 */
export async function deleteMembership(
  params: { organizationId: string; membershipId: string },
  client: DbClient = prisma
): Promise<MembershipWithUser | null> {
  const existing = await findMembershipById(params, client);
  if (!existing) {
    return null;
  }

  await client.membership.delete({ where: { id: params.membershipId } });
  return existing;
}
