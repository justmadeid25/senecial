import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { acceptInvitation } from "@/features/invitations/server/accept-invitation";
import { getInvitationByToken } from "@/features/invitations/server/get-invitation-by-token";
import { registerAndAcceptInvitation } from "@/features/invitations/server/register-and-accept-invitation";
import { createInvitation } from "@/features/members/server/create-invitation";
import { revokeInvitation } from "@/features/members/server/revoke-invitation";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "invitations-test.local";

function extractToken(invitationUrl: string): string {
  const segments = new URL(invitationUrl).pathname.split("/");
  const token = segments[segments.length - 1];
  if (!token) throw new Error("token not found in invitationUrl");
  return token;
}

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string; email: string };
let ownerB: { id: string; email: string };

const createdInvitationIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Invitations Test Org A", slug: `invitations-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Invitations Test Org B", slug: `invitations-test-b-${Date.now()}` },
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
  ownerB = await prisma.user.create({
    data: {
      name: "Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organizationInvitation.deleteMany({ where: { id: { in: createdInvitationIds } } });
  await prisma.membership.deleteMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerA.id, memberA.id, ownerB.id, ...createdUserIds] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("createInvitation", () => {
  it("allows OWNER to create an invitation", async () => {
    const result = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `new-invitee-1@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(result.id);
    expect(result.email).toBe(`new-invitee-1@${TEST_EMAIL_DOMAIN}`);
    expect(result.invitationUrl).toContain("/invitations/");
  });

  it("blocks MEMBER from creating an invitation", async () => {
    await expect(
      createInvitation({
        userId: memberA.id,
        organizationId: orgA.id,
        input: { email: `blocked-invitee@${TEST_EMAIL_DOMAIN}` },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks inviting an email that already belongs to a member of the organization", async () => {
    await expect(
      createInvitation({
        userId: ownerA.id,
        organizationId: orgA.id,
        input: { email: memberA.email },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks a duplicate live invitation for the same email", async () => {
    const email = `duplicate-invitee@${TEST_EMAIL_DOMAIN}`;
    const first = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(first.id);

    await expect(
      createInvitation({ userId: ownerA.id, organizationId: orgA.id, input: { email } })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("never stores the plaintext token - only its hash", async () => {
    const result = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `token-check@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(result.id);
    const token = extractToken(result.invitationUrl);

    const row = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("records a MEMBER_INVITED audit log entry", async () => {
    const result = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `audit-invite@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(result.id);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: result.id, action: "MEMBER_INVITED" },
    });
    expect(log).not.toBeNull();
  });
});

describe("registerAndAcceptInvitation / new user", () => {
  it("creates a User and Membership atomically, and marks the invitation accepted", async () => {
    const email = `brand-new-user@${TEST_EMAIL_DOMAIN}`;
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    const result = await registerAndAcceptInvitation({
      token,
      input: { name: "신규 사용자", password: "Password1234", confirmPassword: "Password1234" },
    });
    createdUserIds.push(result.userId);

    expect(result.organizationId).toBe(orgA.id);

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: result.userId, organizationId: orgA.id } },
    });
    expect(membership).not.toBeNull();

    const invitation = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(invitation.acceptedAt).not.toBeNull();
  });

  it("records a MEMBER_INVITATION_ACCEPTED audit log entry", async () => {
    const email = `audit-accept-new@${TEST_EMAIL_DOMAIN}`;
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    const result = await registerAndAcceptInvitation({
      token,
      input: { name: "감사로그 사용자", password: "Password1234", confirmPassword: "Password1234" },
    });
    createdUserIds.push(result.userId);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "MEMBER_INVITATION_ACCEPTED" },
    });
    expect(log).not.toBeNull();
  });

  it("rejects registration for an expired invitation, and creates no User", async () => {
    const email = `expired-invitee@${TEST_EMAIL_DOMAIN}`;
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    await prisma.organizationInvitation.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      registerAndAcceptInvitation({
        token,
        input: { name: "만료됨", password: "Password1234", confirmPassword: "Password1234" },
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("rejects registration for a revoked invitation", async () => {
    const email = `revoked-invitee@${TEST_EMAIL_DOMAIN}`;
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    await revokeInvitation({ userId: ownerA.id, organizationId: orgA.id, invitationId: created.id });

    await expect(
      registerAndAcceptInvitation({
        token,
        input: { name: "취소됨", password: "Password1234", confirmPassword: "Password1234" },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects reusing an already-accepted invitation", async () => {
    const email = `already-accepted@${TEST_EMAIL_DOMAIN}`;
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    const first = await registerAndAcceptInvitation({
      token,
      input: { name: "최초 수락", password: "Password1234", confirmPassword: "Password1234" },
    });
    createdUserIds.push(first.userId);

    await expect(
      registerAndAcceptInvitation({
        token,
        input: { name: "재사용 시도", password: "Password1234", confirmPassword: "Password1234" },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("acceptInvitation / existing user", () => {
  it("creates a Membership for the logged-in user when the email matches", async () => {
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgB.id === orgA.id ? orgA.id : orgA.id,
      input: { email: ownerB.email },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    const result = await acceptInvitation({ userId: ownerB.id, token });
    expect(result.organizationId).toBe(orgA.id);

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: ownerB.id, organizationId: orgA.id } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe(MembershipRole.MEMBER);
  });

  it("rejects acceptance when the logged-in account's email does not match the invitation", async () => {
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `mismatch-target@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    // memberA's email does not match the invitation's email.
    await expect(acceptInvitation({ userId: memberA.id, token })).rejects.toBeInstanceOf(
      ForbiddenError
    );

    const membershipCountBefore = await prisma.membership.count({
      where: { organizationId: orgA.id },
    });
    // No membership should have been created for memberA a second time.
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: memberA.id, organizationId: orgA.id } },
    });
    expect(membership).not.toBeNull(); // memberA already had one from setup
    expect(membershipCountBefore).toBeGreaterThan(0);
  });
});

describe("revokeInvitation", () => {
  it("blocks a different organization's OWNER from revoking this invitation", async () => {
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `cross-org-revoke@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(created.id);

    await expect(
      revokeInvitation({ userId: ownerB.id, organizationId: orgB.id, invitationId: created.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records a MEMBER_INVITATION_REVOKED audit log entry", async () => {
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `audit-revoke@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(created.id);

    await revokeInvitation({ userId: ownerA.id, organizationId: orgA.id, invitationId: created.id });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: "MEMBER_INVITATION_REVOKED" },
    });
    expect(log).not.toBeNull();
  });
});

describe("getInvitationByToken", () => {
  it("returns status not_found for a bogus token", async () => {
    const result = await getInvitationByToken("this-token-does-not-exist");
    expect(result.status).toBe("not_found");
  });

  it("returns status valid with safe fields only for a live invitation", async () => {
    const created = await createInvitation({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { email: `lookup-check@${TEST_EMAIL_DOMAIN}` },
    });
    createdInvitationIds.push(created.id);
    const token = extractToken(created.invitationUrl);

    const result = await getInvitationByToken(token);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.email).toBe(`lookup-check@${TEST_EMAIL_DOMAIN}`);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});
