import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerUser } from "@/features/auth/server/register-user";
import { ConflictError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "register-test.local";
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function cleanup() {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (createdOrganizationIds.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
  });
});

afterAll(cleanup);

describe("registerUser", () => {
  it("creates a User, an Organization, and an OWNER Membership atomically", async () => {
    const email = `alice@${TEST_EMAIL_DOMAIN}`;

    const result = await registerUser({
      name: "Alice",
      companyName: "Alice Corp",
      email,
      password: "Password123",
      confirmPassword: "Password123",
    });

    createdUserIds.push(result.userId);
    createdOrganizationIds.push(result.organizationId);

    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(email);
    // passwordHash must never equal the plaintext password.
    expect(user?.passwordHash).not.toBe("Password123");

    const organization = await prisma.organization.findUnique({
      where: { id: result.organizationId },
    });
    expect(organization).not.toBeNull();
    expect(organization?.name).toBe("Alice Corp");

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: result.userId,
          organizationId: result.organizationId,
        },
      },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("OWNER");

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: result.organizationId, action: "ORGANIZATION_CREATED" },
    });
    expect(auditLog).not.toBeNull();
    expect(auditLog?.userId).toBe(result.userId);
  });

  it("rejects registration with an email that is already in use", async () => {
    const email = `bob@${TEST_EMAIL_DOMAIN}`;

    const first = await registerUser({
      name: "Bob",
      companyName: "Bob Corp",
      email,
      password: "Password123",
      confirmPassword: "Password123",
    });
    createdUserIds.push(first.userId);
    createdOrganizationIds.push(first.organizationId);

    await expect(
      registerUser({
        name: "Bob Again",
        companyName: "Another Corp",
        email,
        password: "Password123",
        confirmPassword: "Password123",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // No second user/org should exist for this email.
    const users = await prisma.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);
  });

  it("rolls back the entire nested write (User+Organization+Membership) if any part fails", async () => {
    // Exercises the same $transaction/nested-write mechanism registerUser
    // relies on: force the nested Organization create to fail (duplicate
    // slug) and confirm the User row is not left behind.
    const conflictingSlug = `rollback-test-${Date.now()}`;
    const blockerOrg = await prisma.organization.create({
      data: { name: "Blocker Org", slug: conflictingSlug },
    });
    createdOrganizationIds.push(blockerOrg.id);

    const email = `rollback@${TEST_EMAIL_DOMAIN}`;

    await expect(
      prisma.user.create({
        data: {
          name: "Rollback Test",
          email,
          passwordHash: "irrelevant-for-this-test",
          memberships: {
            create: {
              role: "OWNER",
              organization: {
                create: { name: "Rollback Org", slug: conflictingSlug },
              },
            },
          },
        },
      })
    ).rejects.toThrow();

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});
