import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { verifyCredentials } from "@/features/auth/server/verify-credentials";
import { passwordHasher } from "@/server/auth/password-hasher";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "login-test.local";
const PASSWORD = "Password123";

let organization: { id: string };
let userWithMembership: { id: string; email: string };
let userWithoutMembership: { id: string; email: string };

beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
  });

  organization = await prisma.organization.create({
    data: { name: "Login Test Org", slug: `login-test-${Date.now()}` },
  });

  const passwordHash = await passwordHasher.hash(PASSWORD);

  userWithMembership = await prisma.user.create({
    data: {
      name: "Has Membership",
      email: `has-membership@${TEST_EMAIL_DOMAIN}`,
      passwordHash,
      memberships: { create: { organizationId: organization.id, role: MembershipRole.MEMBER } },
    },
  });

  userWithoutMembership = await prisma.user.create({
    data: {
      name: "No Membership",
      email: `no-membership@${TEST_EMAIL_DOMAIN}`,
      passwordHash,
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userWithMembership.id, userWithoutMembership.id] } },
  });
  await prisma.organization.deleteMany({ where: { id: organization.id } });
});

describe("verifyCredentials", () => {
  it("succeeds with the correct password and returns the user's organization/role", async () => {
    const result = await verifyCredentials({
      email: userWithMembership.email,
      password: PASSWORD,
    });

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(userWithMembership.id);
    expect(result?.organizationId).toBe(organization.id);
    expect(result?.role).toBe("MEMBER");
  });

  it("fails with an incorrect password", async () => {
    const result = await verifyCredentials({
      email: userWithMembership.email,
      password: "WrongPassword123",
    });
    expect(result).toBeNull();
  });

  it("fails for an email that does not exist", async () => {
    const result = await verifyCredentials({
      email: `nobody@${TEST_EMAIL_DOMAIN}`,
      password: PASSWORD,
    });
    expect(result).toBeNull();
  });

  it("blocks login for a user with no organization membership", async () => {
    const result = await verifyCredentials({
      email: userWithoutMembership.email,
      password: PASSWORD,
    });
    expect(result).toBeNull();
  });
});
