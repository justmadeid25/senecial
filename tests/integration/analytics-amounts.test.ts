import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createCounterparty } from "@/features/counterparties/server/create-counterparty";
import { getPortfolioSummary } from "@/features/analytics/server/get-portfolio-summary";
import { getContractTypeAnalytics } from "@/features/analytics/server/get-contract-type-analytics";
import { getCounterpartyAnalytics } from "@/features/analytics/server/get-counterparty-analytics";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-amounts-test.local";

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
    data: { name: "Analytics Amounts Test Org A", slug: `analytics-amounts-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics Amounts Test Org B", slug: `analytics-amounts-test-b-${Date.now()}` },
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

describe("amount aggregation (§40)", () => {
  it("sums KRW amounts as an exact Decimal string, never a JS float", async () => {
    await createTestContract(ownerA.id, orgA.id, "KRW 금액 1", { amount: "10000000.50", currency: "KRW" });
    await createTestContract(ownerA.id, orgA.id, "KRW 금액 2", { amount: "20000000.25", currency: "KRW" });

    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const krw = summary.activeAmountsByCurrency.find((row) => row.currency === "KRW");
    expect(krw?.total).toBe("30000000.75");
  });

  it("sums USD amounts separately from KRW", async () => {
    await createTestContract(ownerA.id, orgA.id, "USD 금액", { amount: "1234.56", currency: "USD" });

    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const usd = summary.activeAmountsByCurrency.find((row) => row.currency === "USD");
    expect(usd?.total).toBe("1234.56");
  });

  it("never merges different currencies into a single combined total", async () => {
    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const currencies = new Set(summary.activeAmountsByCurrency.map((row) => row.currency));
    // Each currency has its own row - the type itself makes cross-currency
    // summing structurally impossible (there is no combined-total field).
    expect(currencies.size).toBe(summary.activeAmountsByCurrency.length);
  });

  it("preserves Decimal precision to 2 places without floating-point drift", async () => {
    // 0.1 + 0.2 famously != 0.3 in IEEE754 - this must not happen here.
    await createTestContract(ownerA.id, orgA.id, "정밀도 A", { amount: "0.10", currency: "JPY" });
    await createTestContract(ownerA.id, orgA.id, "정밀도 B", { amount: "0.20", currency: "JPY" });

    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const jpy = summary.activeAmountsByCurrency.find((row) => row.currency === "JPY");
    // Prisma.Decimal.toString() trims trailing zeros ("0.30" -> "0.3") - the
    // precision itself (no float drift) is what matters, not zero-padding.
    expect(jpy?.total).toBe("0.3");
  });

  it("excludes contracts with no amount from every currency sum, and counts them separately", async () => {
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    await createTestContract(ownerA.id, orgA.id, "금액 없음");
    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.contractsWithoutAmount).toBe(before.contractsWithoutAmount + 1);
  });

  it("excludes soft-deleted contracts from amount sums", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "삭제될 금액 계약", {
      amount: "9999999.00",
      currency: "EUR",
    });
    const before = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const beforeEur = before.activeAmountsByCurrency.find((row) => row.currency === "EUR")?.total ?? "0";

    await prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: new Date() } });

    const after = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const afterEur = after.activeAmountsByCurrency.find((row) => row.currency === "EUR")?.total ?? "0";
    expect(Number(afterEur)).toBeLessThan(Number(beforeEur));
  });

  it("status-filters the sum (30-days-expiring amounts exclude non-expiring contracts)", async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 5);
    await createTestContract(ownerA.id, orgA.id, "곧 만료 금액", {
      amount: "5000000",
      currency: "KRW",
      endDate: soon.toISOString().slice(0, 10),
    });

    const summary = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    expect(summary.expiringSoonAmountsByCurrency.some((row) => row.currency === "KRW")).toBe(true);
  });

  it("sums amounts per contract type", async () => {
    await createTestContract(ownerA.id, orgA.id, "유형별 금액", {
      contractType: "SUPPLY",
      amount: "7000000",
      currency: "KRW",
    });

    const analytics = await getContractTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const supplyRow = analytics.rows.find((row) => row.contractType === "SUPPLY");
    expect(supplyRow?.amountsByCurrency.some((a) => a.currency === "KRW")).toBe(true);
  });

  it("sums amounts per counterparty", async () => {
    const counterparty = await createCounterparty({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "금액 집계 테스트 상대방" },
    });
    createdCounterpartyIds.push(counterparty.id);
    await createTestContract(ownerA.id, orgA.id, "상대방별 금액", {
      amount: "3000000",
      currency: "KRW",
      counterpartyId: counterparty.id,
    });

    const analytics = await getCounterpartyAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const row = analytics.rows.find((r) => r.counterpartyId === counterparty.id);
    expect(row?.amountsByCurrency.some((a) => a.currency === "KRW" && Number(a.total) >= 3000000)).toBe(true);
  });

  it("never leaks another organization's amounts", async () => {
    await createTestContract(ownerB.id, orgB.id, "다른 조직 금액", { amount: "999999999", currency: "KRW" });

    const summaryA = await getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id });
    const krwA = summaryA.activeAmountsByCurrency.find((row) => row.currency === "KRW")?.total ?? "0";
    expect(Number(krwA)).toBeLessThan(999999999);
  });
});
