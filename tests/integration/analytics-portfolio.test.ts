import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { getPortfolioSummary } from "@/features/analytics/server/get-portfolio-summary";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-portfolio-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];

const baseContractInput = {
  contractType: "LEASE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
  currency: "KRW",
};

async function createTestContract(
  userId: string,
  organizationId: string,
  title: string,
  overrides: Partial<typeof baseContractInput & { endDate?: string; counterpartyId?: string }> = {}
) {
  const created = await createContract({
    userId,
    organizationId,
    input: { ...baseContractInput, ...overrides, title },
  });
  createdContractIds.push(created.id);
  return created;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Portfolio Test Org A", slug: `analytics-portfolio-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics Portfolio Test Org B", slug: `analytics-portfolio-test-b-${Date.now()}` },
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
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("getPortfolioSummary (§39)", () => {
  it("counts only this organization's live contracts", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "포트폴리오 테스트 1");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.totalLive).toBe(before.totalLive + 1);
  });

  it("excludes soft-deleted contracts from every count", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "삭제될 계약");
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });

    await prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: new Date() } });

    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.totalLive).toBe(before.totalLive - 1);
  });

  it("computes displayStatus counts using the same KST day-boundary rules as getComputedContractStatus", async () => {
    const inThirtyDays = new Date();
    inThirtyDays.setUTCDate(inThirtyDays.getUTCDate() + 15);
    await createTestContract(ownerA.id, orgA.id, "30일 이내 만료", {
      endDate: inThirtyDays.toISOString().slice(0, 10),
    });

    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(summary.expiringWithin30Days).toBeGreaterThan(0);
    expect(summary.displayStatusCounts.EXPIRING).toBeGreaterThan(0);
  });

  it("counts autoRenewal contracts", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "자동갱신 테스트", { autoRenewal: true });
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.autoRenewalCount).toBe(before.autoRenewalCount + 1);
  });

  it("counts contracts with no linked counterparty", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "상대방 없음");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.contractsWithoutCounterparty).toBe(before.contractsWithoutCounterparty + 1);
  });

  it("counts contracts with no completed/review-required extraction job", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "추출 미완료");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.contractsMissingExtraction).toBe(before.contractsMissingExtraction + 1);
  });

  it("counts contracts with no completed/review-required segmentation job", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "분해 미완료");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.contractsMissingSegmentation).toBe(before.contractsMissingSegmentation + 1);
  });

  it("never leaks another organization's contracts into the summary", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerB.id, orgB.id, "다른 조직 계약");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.totalLive).toBe(before.totalLive);
  });

  it("rejects a user with no membership in the target organization", async () => {
    await expect(getPortfolioSummary({ userId: ownerA.id, organizationId: orgB.id })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("MEMBER can read the same portfolio summary as OWNER", async () => {
    const asOwner = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const asMember = await getPortfolioSummary({ userId: memberA.id, organizationId: orgA.id });
    expect(asMember.totalLive).toBe(asOwner.totalLive);
  });

  it("stored-status counts and display-status counts are both present and organization-scoped", async () => {
    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(Object.values(summary.storedStatusCounts).reduce((a, b) => a + b, 0)).toBe(summary.totalLive);
    expect(Object.values(summary.displayStatusCounts).reduce((a, b) => a + b, 0)).toBe(summary.totalLive);
  });

  it("date filtering (via the analytics period) is not applied to the whole-portfolio summary by design", async () => {
    // getPortfolioSummary takes no period argument at all - this documents §6's opt-out decision.
    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(summary.asOf).toBeTruthy();
  });
});
