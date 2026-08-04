import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type OrganizationInvitationRow = Prisma.OrganizationInvitationGetPayload<Record<string, never>>;

const withInviter = {
  invitedBy: { select: { id: true, name: true } },
} satisfies Prisma.OrganizationInvitationInclude;

export type OrganizationInvitationWithInviter = Prisma.OrganizationInvitationGetPayload<{
  include: typeof withInviter;
}>;

export interface CreateInvitationData {
  organizationId: string;
  email: string;
  role: MembershipRole;
  tokenHash: string;
  invitedById: string;
  expiresAt: Date;
}

export async function createInvitation(
  data: CreateInvitationData,
  client: DbClient = prisma
): Promise<OrganizationInvitationRow> {
  return client.organizationInvitation.create({ data });
}

/** A "live" invitation is one that has not been accepted or revoked yet - expiry is checked separately by the caller against `now`. */
export async function findLiveInvitationByEmail(
  params: { organizationId: string; email: string },
  client: DbClient = prisma
): Promise<OrganizationInvitationRow | null> {
  return client.organizationInvitation.findFirst({
    where: {
      organizationId: params.organizationId,
      email: params.email,
      acceptedAt: null,
      revokedAt: null,
    },
  });
}

/**
 * Looked up by tokenHash only - never by organizationId, since the caller
 * does not yet know which organization a raw token belongs to. Every
 * subsequent check (expiry, accepted/revoked state) happens in the calling
 * service, which is what actually decides whether the token is usable.
 */
export async function findInvitationByTokenHash(
  tokenHash: string,
  client: DbClient = prisma
): Promise<OrganizationInvitationWithInviter | null> {
  return client.organizationInvitation.findUnique({
    where: { tokenHash },
    include: withInviter,
  });
}

export async function findInvitationById(
  params: { organizationId: string; invitationId: string },
  client: DbClient = prisma
): Promise<OrganizationInvitationWithInviter | null> {
  return client.organizationInvitation.findFirst({
    where: { id: params.invitationId, organizationId: params.organizationId },
    include: withInviter,
  });
}

export async function findLiveInvitationsByOrganization(
  organizationId: string,
  client: DbClient = prisma
): Promise<OrganizationInvitationWithInviter[]> {
  return client.organizationInvitation.findMany({
    where: { organizationId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    include: withInviter,
  });
}

/**
 * Scoped updateMany that also re-checks acceptedAt/revokedAt are still
 * both null at the moment of the write - this is what actually prevents
 * two concurrent accept requests (or an accept racing a revoke) from both
 * succeeding. Returns true only if this call is the one that transitioned
 * the row.
 */
export async function markInvitationAccepted(
  params: { organizationId: string; invitationId: string; acceptedAt: Date },
  client: DbClient = prisma
): Promise<boolean> {
  const result = await client.organizationInvitation.updateMany({
    where: {
      id: params.invitationId,
      organizationId: params.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { acceptedAt: params.acceptedAt },
  });
  return result.count > 0;
}

/**
 * Phase 10B section 19 - resend rotates the token/expiry on the SAME
 * invitation row rather than creating a new invitation or revoking the
 * old one: the invited email/role/inviter/organization all stay put, only
 * the credential (tokenHash) and its expiry change, and `resendCount`
 * increments to give each resend event a distinct mail idempotency key
 * (domain/email/idempotency-key.ts). Re-checks acceptedAt/revokedAt are
 * still both null at write time - a live-looking invitation could have
 * just been accepted/revoked between the caller's read and this write.
 */
export async function rotateInvitationToken(
  params: { organizationId: string; invitationId: string; tokenHash: string; expiresAt: Date },
  client: DbClient = prisma
): Promise<OrganizationInvitationRow | null> {
  const result = await client.organizationInvitation.updateMany({
    where: {
      id: params.invitationId,
      organizationId: params.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: {
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      resendCount: { increment: 1 },
    },
  });

  if (result.count === 0) {
    return null;
  }

  return client.organizationInvitation.findFirst({
    where: { id: params.invitationId, organizationId: params.organizationId },
  });
}

export async function revokeInvitation(
  params: { organizationId: string; invitationId: string; revokedAt: Date },
  client: DbClient = prisma
): Promise<boolean> {
  const result = await client.organizationInvitation.updateMany({
    where: {
      id: params.invitationId,
      organizationId: params.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: params.revokedAt },
  });
  return result.count > 0;
}
