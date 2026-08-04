import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import {
  verifyOrganizationMembership,
  verifyOrganizationRole,
} from "@/lib/permissions/verify-membership";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "permissions-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let userWithNoMembership: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
  });

  orgA = await prisma.organization.create({
    data: { name: "Org A", slug: `org-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Org B", slug: `org-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  memberA = await prisma.user.create({
    data: {
      name: "Member A",
      email: `member-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
    },
  });
  userWithNoMembership = await prisma.user.create({
    data: {
      name: "No Membership",
      email: `no-membership@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [ownerA.id, memberA.id, userWithNoMembership.id] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("verifyOrganizationMembership", () => {
  it("returns the AuthContext for a real membership", async () => {
    const context = await verifyOrganizationMembership(ownerA.id, orgA.id);
    expect(context).toEqual({ userId: ownerA.id, organizationId: orgA.id, role: "OWNER" });
  });

  it("throws ForbiddenError when the user has no membership in the organization at all", async () => {
    await expect(
      verifyOrganizationMembership(userWithNoMembership.id, orgA.id)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot be forged with another organization's id (org A user vs org B)", async () => {
    // ownerA is a real, valid member of orgA - but must never be treated as
    // authorized for orgB just because both ids are individually valid.
    await expect(
      verifyOrganizationMembership(ownerA.id, orgB.id)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("verifyOrganizationRole", () => {
  it("allows an OWNER through an OWNER-only check", async () => {
    const context = await verifyOrganizationRole(ownerA.id, orgA.id, MembershipRole.OWNER);
    expect(context.role).toBe("OWNER");
  });

  it("blocks a MEMBER from an OWNER-only check", async () => {
    await expect(
      verifyOrganizationRole(memberA.id, orgA.id, MembershipRole.OWNER)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
