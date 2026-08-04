import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { listAuditLogs } from "@/features/audit/server/list-audit-logs";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "audit-logs-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Audit Log Test Org A", slug: `audit-log-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Audit Log Test Org B", slug: `audit-log-test-b-${Date.now()}` },
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

  const contractA = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: {
      title: "감사로그 테스트 계약 A",
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
  createdContractIds.push(contractA.id);

  const contractB = await createContract({
    userId: ownerB.id,
    organizationId: orgB.id,
    input: {
      title: "감사로그 테스트 계약 B",
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
  createdContractIds.push(contractB.id);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("listAuditLogs", () => {
  it("allows OWNER to view the organization's audit logs", async () => {
    const result = await listAuditLogs({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: {},
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some((item) => item.action === "CONTRACT_CREATED")).toBe(true);
  });

  it("blocks MEMBER from viewing audit logs", async () => {
    await expect(
      listAuditLogs({ userId: memberA.id, organizationId: orgA.id, query: {} })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never leaks org B's audit logs into org A's results", async () => {
    const result = await listAuditLogs({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: {},
    });
    expect(result.items.every((item) => item.entityId !== "")).toBe(true);
    const orgBLog = await prisma.auditLog.findFirst({
      where: { organizationId: orgB.id, action: "CONTRACT_CREATED" },
    });
    expect(orgBLog).not.toBeNull();
    expect(result.items.find((item) => item.entityId === orgBLog?.entityId)).toBeUndefined();
  });

  it("filters by action", async () => {
    const result = await listAuditLogs({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { action: "CONTRACT_CREATED" },
    });
    expect(result.items.every((item) => item.action === "CONTRACT_CREATED")).toBe(true);
  });

  it("filters by date range", async () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await listAuditLogs({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { startDate: farFuture },
    });
    expect(result.items).toHaveLength(0);
  });

  it("paginates results", async () => {
    const result = await listAuditLogs({
      userId: ownerA.id,
      organizationId: orgA.id,
      query: { pageSize: "1" },
    });
    expect(result.items.length).toBeLessThanOrEqual(1);
    expect(result.pageSize).toBe(1);
  });

  it("never exposes disallowed metadata fields (e.g. storageKey) in the formatted description", () => {
    // Regression guard at the integration boundary too - the domain unit
    // tests already cover this directly, but this confirms the service
    // wiring doesn't reintroduce a passthrough.
    return listAuditLogs({ userId: ownerA.id, organizationId: orgA.id, query: {} }).then(
      (result) => {
        for (const item of result.items) {
          expect(item.description).not.toContain("storageKey");
          expect(item.description).not.toContain("tokenHash");
        }
      }
    );
  });
});
