import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { getReviewSignalAnalytics } from "@/features/analytics/server/get-review-signal-analytics";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-signal-filter-test.local";

let orgA: { id: string };
let ownerA: { id: string };

const createdContractIds: string[] = [];

async function createTestContract(title: string, overrides: Record<string, unknown> = {}) {
  const created = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: { title, contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW", ...overrides },
  });
  createdContractIds.push(created.id);
  return created;
}

async function createSignal(params: {
  contractId: string;
  signalType: string;
  status: string;
  clauseType?: string;
  createdAt?: Date;
}) {
  return prisma.clauseReviewSignal.create({
    data: {
      organizationId: orgA.id,
      contractId: params.contractId,
      signalType: params.signalType as never,
      status: params.status as never,
      clauseType: (params.clauseType ?? null) as never,
      title: "필터 전파 테스트 신호",
      description: "필터 전파 테스트용 검토 신호입니다.",
      ruleVersion: "test-v1",
      signalKey: randomUUID(),
      createdAt: params.createdAt,
    },
  });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Signal Filter Test Org", slug: `analytics-signal-filter-test-${Date.now()}` },
  });
  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: orgA.id } });
});

describe("filters propagate into getReviewSignalAnalytics (§5/§11)", () => {
  it("contract-level filter (contractType) excludes signals from a non-matching contract", async () => {
    const matching = await createTestContract("신호전파 매치", { contractType: "SUPPLY" });
    const nonMatching = await createTestContract("신호전파 불일치", { contractType: "NDA" });
    await createSignal({ contractId: matching.id, signalType: "UNUSUAL_DURATION", status: "OPEN" });
    await createSignal({ contractId: nonMatching.id, signalType: "UNUSUAL_DURATION", status: "OPEN" });

    const filtered = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "SUPPLY" },
    });
    const row = filtered.rows.find((r) => r.signalType === "UNUSUAL_DURATION");
    expect(row?.totalCount).toBe(1);
  });

  it("clauseType filter narrows to only signals tagged with that clause type", async () => {
    const contract = await createTestContract("clauseType 신호 필터");
    await createSignal({
      contractId: contract.id,
      signalType: "MISSING_EXPECTED_CLAUSE",
      status: "OPEN",
      clauseType: "TERMINATION",
    });
    await createSignal({
      contractId: contract.id,
      signalType: "MISSING_EXPECTED_CLAUSE",
      status: "OPEN",
      clauseType: "CONFIDENTIALITY",
    });

    const filtered = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { clauseType: "TERMINATION" },
    });
    const row = filtered.rows.find((r) => r.signalType === "MISSING_EXPECTED_CLAUSE");
    expect(row?.totalCount).toBe(1);
  });

  it("signalStatus filter narrows the totals to only that status", async () => {
    const contract = await createTestContract("signalStatus 필터");
    await createSignal({ contractId: contract.id, signalType: "MANUAL_REVIEW", status: "OPEN" });
    await createSignal({ contractId: contract.id, signalType: "MANUAL_REVIEW", status: "DISMISSED" });

    const filtered = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { signalStatus: "DISMISSED" },
    });
    const row = filtered.rows.find((r) => r.signalType === "MANUAL_REVIEW");
    expect(row?.statusCounts.DISMISSED).toBe(1);
    expect(row?.statusCounts.OPEN).toBe(0);
  });

  it("signalType filter narrows the row set to only that type", async () => {
    const contract = await createTestContract("signalType 필터");
    await createSignal({ contractId: contract.id, signalType: "BROAD_INDEMNITY_LANGUAGE", status: "OPEN" });
    await createSignal({ contractId: contract.id, signalType: "ONE_SIDED_TERMINATION_LANGUAGE", status: "OPEN" });

    const filtered = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { signalType: "BROAD_INDEMNITY_LANGUAGE" },
    });
    expect(filtered.rows.every((r) => r.signalType === "BROAD_INDEMNITY_LANGUAGE")).toBe(true);
    expect(filtered.rows.find((r) => r.signalType === "BROAD_INDEMNITY_LANGUAGE")?.totalCount).toBe(1);
  });

  it("composite filter (contractType + signalStatus + signalType) narrows correctly together", async () => {
    const matching = await createTestContract("복합신호필터 매치", { contractType: "LICENSE" });
    const wrongType = await createTestContract("복합신호필터 계약유형불일치", { contractType: "NDA" });
    await createSignal({ contractId: matching.id, signalType: "UNUSUAL_NUMBER", status: "ACKNOWLEDGED" });
    await createSignal({ contractId: matching.id, signalType: "UNUSUAL_NUMBER", status: "OPEN" });
    await createSignal({ contractId: wrongType.id, signalType: "UNUSUAL_NUMBER", status: "ACKNOWLEDGED" });

    const filtered = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "LICENSE", signalStatus: "ACKNOWLEDGED", signalType: "UNUSUAL_NUMBER" },
    });
    const row = filtered.rows.find((r) => r.signalType === "UNUSUAL_NUMBER");
    expect(row?.totalCount).toBe(1);
    expect(row?.statusCounts.ACKNOWLEDGED).toBe(1);
  });

  it("period filter (signal createdAt) excludes signals created outside the range", async () => {
    const contract = await createTestContract("신호기간필터");
    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    await createSignal({
      contractId: contract.id,
      signalType: "UNLIMITED_LIABILITY_LANGUAGE",
      status: "OPEN",
      createdAt: twoYearsAgo,
    });
    await createSignal({ contractId: contract.id, signalType: "UNLIMITED_LIABILITY_LANGUAGE", status: "OPEN" });

    const recentOnly = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    const row = recentOnly.rows.find((r) => r.signalType === "UNLIMITED_LIABILITY_LANGUAGE");
    expect(row?.totalCount).toBe(1);
  });

  it("excludes signals belonging to a soft-deleted contract", async () => {
    const contract = await createTestContract("삭제계약신호필터");
    await createSignal({ contractId: contract.id, signalType: "MANUAL_REVIEW", status: "OPEN" });

    const before = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const beforeTotal = before.rows.find((r) => r.signalType === "MANUAL_REVIEW")?.totalCount ?? 0;

    await prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: new Date() } });

    const after = await getReviewSignalAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const afterTotal = after.rows.find((r) => r.signalType === "MANUAL_REVIEW")?.totalCount ?? 0;
    expect(afterTotal).toBe(beforeTotal - 1);
  });

  it("never leaks another organization's signals into a filtered query", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Analytics Signal Filter Other Org", slug: `analytics-signal-filter-other-${Date.now()}` },
    });
    const otherOwner = await prisma.user.create({
      data: {
        name: "Other Owner",
        email: `other-owner@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: otherOrg.id, role: MembershipRole.OWNER } },
      },
    });
    const otherContract = await createContract({
      userId: otherOwner.id,
      organizationId: otherOrg.id,
      input: { title: "다른 조직 신호 필터", contractType: "EMPLOYMENT", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
    });
    await createSignal({ contractId: otherContract.id, signalType: "ONE_SIDED_TERMINATION_LANGUAGE", status: "OPEN" });

    const result = await getReviewSignalAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "EMPLOYMENT" },
    });
    expect(result.rows.find((r) => r.signalType === "ONE_SIDED_TERMINATION_LANGUAGE")).toBeUndefined();

    await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.contract.deleteMany({ where: { id: otherContract.id } });
    await prisma.user.deleteMany({ where: { id: otherOwner.id } });
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
