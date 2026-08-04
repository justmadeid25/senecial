import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createCounterparty } from "@/features/counterparties/server/create-counterparty";
import { getPortfolioSummary } from "@/features/analytics/server/get-portfolio-summary";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-contract-filters-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];
const createdCounterpartyIds: string[] = [];

async function createTestContract(
  userId: string,
  organizationId: string,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  const created = await createContract({
    userId,
    organizationId,
    input: {
      title,
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
      ...overrides,
    },
  });
  createdContractIds.push(created.id);
  return created;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Contract Filters Test Org A", slug: `analytics-contract-filters-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics Contract Filters Test Org B", slug: `analytics-contract-filters-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
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
  await prisma.counterparty.deleteMany({ where: { id: { in: createdCounterpartyIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("contract-level analytics filters propagate into getPortfolioSummary (§11)", () => {
  it("contractType filter narrows totalLive to only that type", async () => {
    await createTestContract(ownerA.id, orgA.id, "필터 유형 SERVICE", { contractType: "SERVICE" });
    await createTestContract(ownerA.id, orgA.id, "필터 유형 LEASE", { contractType: "LEASE" });

    const filtered = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "LEASE" },
    });
    const unfiltered = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });

    expect(filtered.totalLive).toBeLessThan(unfiltered.totalLive);
    expect(filtered.totalLive).toBeGreaterThanOrEqual(1);
  });

  it("displayStatus=ACTIVE filter matches the same set the contract list's ACTIVE filter would", async () => {
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 200);
    await createTestContract(ownerA.id, orgA.id, "ACTIVE 필터 테스트", { endDate: farFuture.toISOString().slice(0, 10) });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { displayStatus: "ACTIVE" },
    });
    expect(result.totalLive).toBeGreaterThanOrEqual(1);
    // Every card is scoped to ACTIVE - the EXPIRING/EXPIRED breakdown cards must be 0.
    expect(result.expiringWithin30Days).toBe(0);
  });

  it("displayStatus=EXPIRING filter only includes contracts within the 30-day window", async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    await createTestContract(ownerA.id, orgA.id, "EXPIRING 필터 테스트", { endDate: soon.toISOString().slice(0, 10) });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { displayStatus: "EXPIRING" },
    });
    expect(result.totalLive).toBeGreaterThanOrEqual(1);
    expect(result.inProgress).toBe(0);
    expect(result.alreadyExpired).toBe(0);
  });

  it("displayStatus=EXPIRED filter only includes already-expired contracts", async () => {
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 30);
    await createTestContract(ownerA.id, orgA.id, "EXPIRED 필터 테스트", { endDate: past.toISOString().slice(0, 10) });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { displayStatus: "EXPIRED" },
    });
    expect(result.totalLive).toBeGreaterThanOrEqual(1);
    expect(result.inProgress).toBe(0);
    expect(result.expiringWithin30Days).toBe(0);
  });

  it("counterparty filter narrows to only that counterparty's contracts", async () => {
    const counterparty = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "필터 대상 상대방" },
    });
    createdCounterpartyIds.push(counterparty.id);
    await createTestContract(ownerA.id, orgA.id, "상대방 연결 계약", { counterpartyId: counterparty.id });
    await createTestContract(ownerA.id, orgA.id, "상대방 없는 계약");

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { counterpartyId: counterparty.id },
    });
    expect(result.contractsWithoutCounterparty).toBe(0);
    expect(result.totalLive).toBeGreaterThanOrEqual(1);
  });

  it("currency filter narrows amount aggregates to only that currency", async () => {
    await createTestContract(ownerA.id, orgA.id, "USD 필터 테스트", { amount: "500", currency: "USD" });
    await createTestContract(ownerA.id, orgA.id, "KRW 필터 테스트", { amount: "500000", currency: "KRW" });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { currency: "USD" },
    });
    expect(result.activeAmountsByCurrency.every((row) => row.currency === "USD")).toBe(true);
  });

  it("autoRenewal=true filter includes only auto-renewal contracts", async () => {
    await createTestContract(ownerA.id, orgA.id, "자동갱신 O", { autoRenewal: true });
    await createTestContract(ownerA.id, orgA.id, "자동갱신 X", { autoRenewal: false });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { autoRenewal: true },
    });
    expect(result.autoRenewalCount).toBe(result.totalLive);
  });

  it("autoRenewal=false filter excludes every auto-renewal contract", async () => {
    await createTestContract(ownerA.id, orgA.id, "자동갱신 X 전용", { autoRenewal: false });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { autoRenewal: false },
    });
    expect(result.autoRenewalCount).toBe(0);
  });

  it("composite filter (contractType + currency + autoRenewal) narrows correctly together", async () => {
    await createTestContract(ownerA.id, orgA.id, "복합필터 매치", {
      contractType: "SUPPLY",
      currency: "JPY",
      amount: "100000",
      autoRenewal: true,
    });
    await createTestContract(ownerA.id, orgA.id, "복합필터 불일치 유형", {
      contractType: "LEASE",
      currency: "JPY",
      amount: "100000",
      autoRenewal: true,
    });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "SUPPLY", currency: "JPY", autoRenewal: true },
    });
    expect(result.totalLive).toBe(1);
  });

  it("excludes soft-deleted contracts even when they'd otherwise match every filter", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "삭제될 필터매치 계약", {
      contractType: "OTHER",
      autoRenewal: true,
    });
    const before = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "OTHER", autoRenewal: true },
    });

    await prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: new Date() } });

    const after = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "OTHER", autoRenewal: true },
    });
    expect(after.totalLive).toBe(before.totalLive - 1);
  });

  it("never includes another organization's contracts, even with matching filters", async () => {
    await createTestContract(ownerB.id, orgB.id, "다른 조직 필터매치", { contractType: "NDA", autoRenewal: true });

    const result = await getPortfolioSummary({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "NDA", autoRenewal: true },
    });
    expect(result.totalLive).toBe(0);
  });
});
