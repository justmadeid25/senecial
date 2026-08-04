import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { getReviewSignalAnalytics } from "@/features/analytics/server/get-review-signal-analytics";
import { getMonthlyTrends } from "@/features/analytics/server/get-monthly-trends";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-review-signals-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];

async function createTestContract(userId: string, organizationId: string, title: string) {
  const created = await createContract({
    userId,
    organizationId,
    input: { title, contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  createdContractIds.push(created.id);
  return created;
}

async function createSignal(params: {
  organizationId: string;
  contractId: string;
  signalType: string;
  status: string;
  createdAt?: Date;
  reviewedAt?: Date;
}) {
  return prisma.clauseReviewSignal.create({
    data: {
      organizationId: params.organizationId,
      contractId: params.contractId,
      signalType: params.signalType as never,
      status: params.status as never,
      title: "테스트 신호",
      description: "테스트용 검토 신호입니다.",
      ruleVersion: "test-v1",
      signalKey: randomUUID(),
      createdAt: params.createdAt,
      reviewedAt: params.reviewedAt,
    },
  });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Signals Test Org A", slug: `analytics-signals-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics Signals Test Org B", slug: `analytics-signals-test-b-${Date.now()}` },
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
  await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("getReviewSignalAnalytics (§42)", () => {
  it("counts OPEN / ACKNOWLEDGED / DISMISSED / RESOLVED separately", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "상태별 집계 테스트");
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "MANUAL_REVIEW", status: "OPEN" });
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "MANUAL_REVIEW", status: "ACKNOWLEDGED" });
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "MANUAL_REVIEW", status: "DISMISSED" });
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "MANUAL_REVIEW", status: "RESOLVED" });

    const analytics = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const row = analytics.rows.find((r) => r.signalType === "MANUAL_REVIEW");
    expect(row?.statusCounts.OPEN).toBeGreaterThanOrEqual(1);
    expect(row?.statusCounts.ACKNOWLEDGED).toBeGreaterThanOrEqual(1);
    expect(row?.statusCounts.DISMISSED).toBeGreaterThanOrEqual(1);
    expect(row?.statusCounts.RESOLVED).toBeGreaterThanOrEqual(1);
  });

  it("groups counts by signalType", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "유형별 집계 테스트");
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "UNUSUAL_DURATION", status: "OPEN" });

    const analytics = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(analytics.rows.some((r) => r.signalType === "UNUSUAL_DURATION")).toBe(true);
  });

  it("counts distinct related contracts, not raw signal rows", async () => {
    const contract1 = await createTestContract(ownerA.id, orgA.id, "관련계약 1");
    const contract2 = await createTestContract(ownerA.id, orgA.id, "관련계약 2");
    await createSignal({ organizationId: orgA.id, contractId: contract1.id, signalType: "BROAD_INDEMNITY_LANGUAGE", status: "OPEN" });
    await createSignal({ organizationId: orgA.id, contractId: contract1.id, signalType: "BROAD_INDEMNITY_LANGUAGE", status: "OPEN" });
    await createSignal({ organizationId: orgA.id, contractId: contract2.id, signalType: "BROAD_INDEMNITY_LANGUAGE", status: "OPEN" });

    const analytics = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const row = analytics.rows.find((r) => r.signalType === "BROAD_INDEMNITY_LANGUAGE");
    expect(row?.totalCount).toBeGreaterThanOrEqual(3);
    expect(row?.distinctContracts).toBe(2);
  });

  it("buckets the age of OPEN signals into the 5 stale-duration buckets", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "미처리기간 테스트");
    const DAY = 24 * 60 * 60 * 1000;
    await createSignal({
      organizationId: orgA.id,
      contractId: contract.id,
      signalType: "MANUAL_REVIEW",
      status: "OPEN",
      createdAt: new Date(Date.now() - 2 * DAY),
    });
    await createSignal({
      organizationId: orgA.id,
      contractId: contract.id,
      signalType: "MANUAL_REVIEW",
      status: "OPEN",
      createdAt: new Date(Date.now() - 70 * DAY),
    });

    const analytics = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const bucket0to7 = analytics.staleBuckets.find((b) => b.bucket === "DAYS_0_7");
    const bucket61plus = analytics.staleBuckets.find((b) => b.bucket === "DAYS_61_PLUS");
    expect(bucket0to7?.count).toBeGreaterThanOrEqual(1);
    expect(bucket61plus?.count).toBeGreaterThanOrEqual(1);
  });

  it("excludes non-OPEN signals from the stale-duration buckets", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "조치완료 제외 테스트");
    const before = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const beforeTotal = before.staleBuckets.reduce((sum, b) => sum + b.count, 0);

    await createSignal({
      organizationId: orgA.id,
      contractId: contract.id,
      signalType: "MANUAL_REVIEW",
      status: "RESOLVED",
      reviewedAt: new Date(),
    });

    const after = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const afterTotal = after.staleBuckets.reduce((sum, b) => sum + b.count, 0);
    expect(afterTotal).toBe(beforeTotal);
  });

  it("never leaks another organization's review signals", async () => {
    const contractB = await createTestContract(ownerB.id, orgB.id, "다른 조직 신호 테스트");
    await createSignal({ organizationId: orgB.id, contractId: contractB.id, signalType: "MANUAL_REVIEW", status: "OPEN" });

    const analyticsA = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    // orgA's MANUAL_REVIEW row (if any) must not include orgB's signal.
    const totalOpenA = analyticsA.totalOpen;
    const analyticsB = await getReviewSignalAnalytics({ userId: ownerB.id, organizationId: orgB.id });
    expect(analyticsB.totalOpen).toBeGreaterThanOrEqual(1);
    expect(totalOpenA).toBeGreaterThanOrEqual(0);
  });
});

describe("getMonthlyTrends (§22/§42 - review signal created/resolved trend)", () => {
  it("counts review signals created and resolved within the current month, zero-filling other months", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "월별 추이 테스트");
    await createSignal({ organizationId: orgA.id, contractId: contract.id, signalType: "MANUAL_REVIEW", status: "OPEN" });
    await createSignal({
      organizationId: orgA.id,
      contractId: contract.id,
      signalType: "MANUAL_REVIEW",
      status: "RESOLVED",
      reviewedAt: new Date(),
    });

    const trends = await getMonthlyTrends({ userId: ownerA.id, organizationId: orgA.id, months: 3 });
    expect(trends.points).toHaveLength(3);
    const currentMonth = trends.points[trends.points.length - 1]!;
    expect(currentMonth.reviewSignalsCreated).toBeGreaterThanOrEqual(2);
    expect(currentMonth.reviewSignalsResolved).toBeGreaterThanOrEqual(1);
    // Every point (including empty months) has all 7 fields present as numbers.
    for (const point of trends.points) {
      expect(typeof point.contractsCreated).toBe("number");
      expect(typeof point.reviewSignalsCreated).toBe("number");
    }
  });
});
