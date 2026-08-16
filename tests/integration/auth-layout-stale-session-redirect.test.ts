import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "auth-layout-redirect-loop-test.local";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    // next/navigation's real redirect() throws to unwind the render - a
    // distinguishable thrown value is exactly what a test needs to assert
    // "did this layout redirect, and to where" without a real Next.js
    // request/response cycle.
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

// Imported after the mocks above so the layouts pick up the mocked modules.
const { default: AuthLayout } = await import("@/app/(auth)/layout");
const { default: DashboardLayout } = await import("@/app/(dashboard)/layout");

let validOrg: { id: string };
let validUser: { id: string; sessionVersion: number };

let deletedUserId: string;

let orphanedMembershipOrg: { id: string };
let orphanedMembershipUser: { id: string; sessionVersion: number };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  validOrg = await prisma.organization.create({
    data: { name: "Auth Layout Redirect Loop Test Org", slug: `auth-layout-redirect-loop-${Date.now()}` },
  });
  validUser = await prisma.user.create({
    data: {
      name: "Valid Session User",
      email: `valid@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      sessionVersion: 1,
      memberships: { create: { organizationId: validOrg.id, role: MembershipRole.OWNER } },
    },
    select: { id: true, sessionVersion: true },
  });

  // A user whose row is deleted after the session was issued - simulates a
  // still-valid (correctly signed) JWT for an account that no longer
  // exists (e.g. an admin deleted the account, or synthetic-data cleanup
  // ran against a test org someone was still logged into).
  const toDelete = await prisma.user.create({
    data: {
      name: "Soon Deleted User",
      email: `deleted@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      sessionVersion: 1,
      memberships: { create: { organizationId: validOrg.id, role: MembershipRole.MEMBER } },
    },
    select: { id: true },
  });
  deletedUserId = toDelete.id;
  await prisma.membership.deleteMany({ where: { userId: deletedUserId } });
  await prisma.user.delete({ where: { id: deletedUserId } });

  // A user whose row still exists (still a genuinely valid account/session)
  // but whose only organization membership was removed after the session
  // was issued - e.g. an owner removed them from the org.
  orphanedMembershipOrg = await prisma.organization.create({
    data: { name: "Orphaned Membership Test Org", slug: `orphaned-membership-${Date.now()}` },
  });
  orphanedMembershipUser = await prisma.user.create({
    data: {
      name: "Removed From Org User",
      email: `removed@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      sessionVersion: 1,
      memberships: { create: { organizationId: orphanedMembershipOrg.id, role: MembershipRole.MEMBER } },
    },
    select: { id: true, sessionVersion: true },
  });
  await prisma.membership.deleteMany({ where: { userId: orphanedMembershipUser.id } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [validOrg.id, orphanedMembershipOrg.id] } } });
  vi.restoreAllMocks();
});

function sessionFor(user: { id: string; sessionVersion: number }, organizationId: string) {
  return { user: { id: user.id, organizationId, sessionVersion: user.sessionVersion } };
}

describe("(auth)/layout.tsx - stale-session redirect loop fix", () => {
  it("valid active session: redirects away from the auth pages to /dashboard", async () => {
    mockAuth.mockResolvedValue(sessionFor(validUser, validOrg.id));

    await expect(AuthLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("no session: renders the auth page (no redirect)", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(AuthLayout({ children: null })).resolves.toBeDefined();
  });

  it("stale session with deleted user: renders the auth page instead of bouncing to /dashboard", async () => {
    // The JWT is still validly signed and still carries the id it was
    // issued with - the user row behind it is simply gone.
    mockAuth.mockResolvedValue(sessionFor({ id: deletedUserId, sessionVersion: 1 }, validOrg.id));

    await expect(AuthLayout({ children: null })).resolves.toBeDefined();
  });

  it("stale session after loss of required organization membership: renders the auth page instead of bouncing to /dashboard", async () => {
    mockAuth.mockResolvedValue(sessionFor(orphanedMembershipUser, orphanedMembershipOrg.id));

    await expect(AuthLayout({ children: null })).resolves.toBeDefined();
  });

  it("direct /login access with a valid session redirects to /dashboard", async () => {
    mockAuth.mockResolvedValue(sessionFor(validUser, validOrg.id));

    await expect(AuthLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});

describe("(dashboard)/layout.tsx - unchanged stale-session behavior (non-regression)", () => {
  it("direct /dashboard access with a stale session (deleted user) redirects to /login", async () => {
    mockAuth.mockResolvedValue(sessionFor({ id: deletedUserId, sessionVersion: 1 }, validOrg.id));

    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("direct /dashboard access with a stale session (lost membership) redirects to /login", async () => {
    mockAuth.mockResolvedValue(sessionFor(orphanedMembershipUser, orphanedMembershipOrg.id));

    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("no redirect loop", () => {
  it("a stale session bounced from /dashboard to /login does not bounce back to /dashboard", async () => {
    const staleSession = sessionFor({ id: deletedUserId, sessionVersion: 1 }, validOrg.id);
    mockAuth.mockResolvedValue(staleSession);

    // Step 1: hitting /dashboard with this session redirects to /login -
    // exactly what happened in production before this fix too.
    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");

    // Step 2: landing on /login with the SAME still-present stale session
    // must NOT redirect back to /dashboard (this is the part that was
    // broken - (auth)/layout.tsx used to trust session.user.id alone and
    // send it straight back to step 1, forever).
    await expect(AuthLayout({ children: null })).resolves.toBeDefined();
  });

  it("a stale session (lost membership) bounced from /dashboard to /login does not bounce back", async () => {
    mockAuth.mockResolvedValue(sessionFor(orphanedMembershipUser, orphanedMembershipOrg.id));

    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(AuthLayout({ children: null })).resolves.toBeDefined();
  });
});
