import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { requireAuthenticatedUser } from "@/lib/permissions/require-authenticated-user";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "session-invalidation-test.local";

let org: { id: string };
let user: { id: string };

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  org = await prisma.organization.create({
    data: { name: "Session Invalidation Test Org", slug: `session-invalidation-test-${Date.now()}` },
  });
  user = await prisma.user.create({
    data: {
      name: "Session Test User",
      email: `user@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      sessionVersion: 3,
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  vi.restoreAllMocks();
});

describe("requireAuthenticatedUser sessionVersion re-verification (§22)", () => {
  it("accepts a session whose sessionVersion matches the live DB value", async () => {
    mockAuth.mockResolvedValue({
      user: { id: user.id, organizationId: org.id, sessionVersion: 3 },
    });

    const result = await requireAuthenticatedUser();
    expect(result.userId).toBe(user.id);
  });

  it("rejects a session whose sessionVersion is stale (e.g. issued before a password reset)", async () => {
    mockAuth.mockResolvedValue({
      // token embeds the OLD version (2) - live DB value is now 3
      user: { id: user.id, organizationId: org.id, sessionVersion: 2 },
    });

    await expect(requireAuthenticatedUser()).rejects.toThrow();
  });

  it("a live sessionVersion bump (simulating a password reset) invalidates a previously-accepted session", async () => {
    mockAuth.mockResolvedValue({
      user: { id: user.id, organizationId: org.id, sessionVersion: 3 },
    });
    await expect(requireAuthenticatedUser()).resolves.toBeDefined();

    // Simulate what resetPassword() does.
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });

    // Same mocked JWT session (still claims sessionVersion: 3) now fails.
    await expect(requireAuthenticatedUser()).rejects.toThrow();
  });

  it("rejects when the session has no sessionVersion at all (malformed/legacy token)", async () => {
    mockAuth.mockResolvedValue({ user: { id: user.id, organizationId: org.id } });
    await expect(requireAuthenticatedUser()).rejects.toThrow();
  });
});
