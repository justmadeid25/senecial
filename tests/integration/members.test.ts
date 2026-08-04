import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { changeMemberRole } from "@/features/members/server/change-member-role";
import { listMembers } from "@/features/members/server/list-members";
import { removeMember } from "@/features/members/server/remove-member";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "members-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };
let membershipMemberA: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Members Test Org A", slug: `members-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Members Test Org B", slug: `members-test-b-${Date.now()}` },
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

  membershipMemberA = await prisma.membership.findUniqueOrThrow({
    where: { userId_organizationId: { userId: memberA.id, organizationId: orgA.id } },
    select: { id: true },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("changeMemberRole", () => {
  it("allows OWNER to promote a MEMBER to OWNER and back", async () => {
    await changeMemberRole({
      userId: ownerA.id,
      organizationId: orgA.id,
      membershipId: membershipMemberA.id,
      input: { role: "OWNER" },
    });
    let row = await prisma.membership.findUniqueOrThrow({ where: { id: membershipMemberA.id } });
    expect(row.role).toBe(MembershipRole.OWNER);

    await changeMemberRole({
      userId: ownerA.id,
      organizationId: orgA.id,
      membershipId: membershipMemberA.id,
      input: { role: "MEMBER" },
    });
    row = await prisma.membership.findUniqueOrThrow({ where: { id: membershipMemberA.id } });
    expect(row.role).toBe(MembershipRole.MEMBER);
  });

  it("blocks MEMBER from changing another member's role", async () => {
    await expect(
      changeMemberRole({
        userId: memberA.id,
        organizationId: orgA.id,
        membershipId: membershipMemberA.id,
        input: { role: "OWNER" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks an OWNER from changing their own role", async () => {
    const ownerMembership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: ownerA.id, organizationId: orgA.id } },
    });
    await expect(
      changeMemberRole({
        userId: ownerA.id,
        organizationId: orgA.id,
        membershipId: ownerMembership.id,
        input: { role: "MEMBER" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks demoting the last remaining OWNER in a single-OWNER organization", async () => {
    // orgB has exactly one OWNER (ownerB). The only way to reach a
    // "demote the last OWNER" call is for that OWNER to target themselves,
    // which the separate self-change guard blocks first - the two
    // requirements ("no self role change" + "last OWNER cannot be
    // demoted") are both satisfied by the same call being rejected here.
    // The underlying ownerCount<=1 branch is exercised directly by
    // tests/unit/last-owner-policy.test.ts.
    const ownerMembership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: ownerB.id, organizationId: orgB.id } },
    });
    await expect(
      changeMemberRole({
        userId: ownerB.id,
        organizationId: orgB.id,
        membershipId: ownerMembership.id,
        input: { role: "MEMBER" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership.id } });
    expect(row.role).toBe(MembershipRole.OWNER);
  });

  it("blocks a different organization's OWNER from changing a membership", async () => {
    await expect(
      changeMemberRole({
        userId: ownerB.id,
        organizationId: orgB.id,
        membershipId: membershipMemberA.id,
        input: { role: "OWNER" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records a MEMBER_ROLE_CHANGED audit log entry with previous/next role only", async () => {
    await changeMemberRole({
      userId: ownerA.id,
      organizationId: orgA.id,
      membershipId: membershipMemberA.id,
      input: { role: "OWNER" },
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: membershipMemberA.id, action: "MEMBER_ROLE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    const metadata = log?.metadata as { previousRole?: string; nextRole?: string } | null;
    expect(metadata?.previousRole).toBe("MEMBER");
    expect(metadata?.nextRole).toBe("OWNER");

    // restore for subsequent tests
    await changeMemberRole({
      userId: ownerA.id,
      organizationId: orgA.id,
      membershipId: membershipMemberA.id,
      input: { role: "MEMBER" },
    });
  });
});

describe("removeMember", () => {
  it("blocks removing the last remaining OWNER in a single-OWNER organization", async () => {
    // Same structural note as the change-role test above: reachable only
    // via self-removal, which the separate self-removal guard blocks
    // first, and which itself already guarantees the last OWNER survives.
    const ownerMembership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: ownerB.id, organizationId: orgB.id } },
    });
    await expect(
      removeMember({ userId: ownerB.id, organizationId: orgB.id, membershipId: ownerMembership.id })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
    expect(row).not.toBeNull();
  });

  it("blocks a different organization's OWNER from removing a membership", async () => {
    await expect(
      removeMember({ userId: ownerB.id, organizationId: orgB.id, membershipId: membershipMemberA.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("allows OWNER to remove a MEMBER, and records a MEMBER_REMOVED audit log entry", async () => {
    const removable = await prisma.user.create({
      data: {
        name: "Removable Member",
        email: `removable@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
      },
    });
    const removableMembership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: removable.id, organizationId: orgA.id } },
    });

    await removeMember({
      userId: ownerA.id,
      organizationId: orgA.id,
      membershipId: removableMembership.id,
    });

    const row = await prisma.membership.findUnique({ where: { id: removableMembership.id } });
    expect(row).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entityId: removableMembership.id, action: "MEMBER_REMOVED" },
    });
    expect(log).not.toBeNull();
  });
});

describe("listMembers", () => {
  it("does not leak org B's members into org A's list", async () => {
    const result = await listMembers({ userId: ownerA.id, organizationId: orgA.id });
    expect(result.some((m) => m.userId === ownerB.id)).toBe(false);
  });

  it("allows MEMBER to view the member list", async () => {
    const result = await listMembers({ userId: memberA.id, organizationId: orgA.id });
    expect(result.length).toBeGreaterThan(0);
  });
});
