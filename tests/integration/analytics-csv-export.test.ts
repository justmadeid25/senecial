import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createCounterparty } from "@/features/counterparties/server/create-counterparty";
import { exportAnalyticsCsv } from "@/features/analytics/server/export-analytics-csv";
import { getPortfolioSummary } from "@/features/analytics/server/get-portfolio-summary";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-csv-export-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];

async function createTestContract(
  userId: string,
  organizationId: string,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  const created = await createContract({
    userId,
    organizationId,
    input: { title, contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW", ...overrides },
  });
  createdContractIds.push(created.id);
  return created;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics CSV Export Test Org A", slug: `analytics-csv-export-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics CSV Export Test Org B", slug: `analytics-csv-export-test-b-${Date.now()}` },
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
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("exportAnalyticsCsv (§43)", () => {
  it("OWNER can export the portfolio CSV", async () => {
    await createTestContract(ownerA.id, orgA.id, "CSV 내보내기 대상 계약");

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: {},
    });
    expect(result.csv).toContain("계약명");
    expect(result.csv).toContain("CSV 내보내기 대상 계약");
  });

  it("MEMBER is blocked from exporting (DB-verified role, not a session claim)", async () => {
    await expect(
      exportAnalyticsCsv({ userId: memberA.id, organizationId: orgA.id, exportType: "portfolio", rawFilters: {} })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never includes another organization's contracts", async () => {
    await createTestContract(ownerB.id, orgB.id, "다른 조직 계약 CSV 유출 테스트");

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: {},
    });
    expect(result.csv).not.toContain("다른 조직 계약 CSV 유출 테스트");
  });

  it("never includes contract description (unlisted, potentially long free-text field)", async () => {
    await createTestContract(ownerA.id, orgA.id, "설명필드 유출 테스트", {
      description: "이 설명은 CSV에 노출되면 안 되는 민감한 내부 메모입니다.",
    });

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: {},
    });
    expect(result.csv).not.toContain("민감한 내부 메모");
  });

  it("neutralizes a CSV-formula-injection contract title", async () => {
    await createTestContract(ownerA.id, orgA.id, "=SUM(A1:A10)");

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: {},
    });
    expect(result.csv).toContain("'=SUM(A1:A10)");
    expect(result.csv).not.toMatch(/(?<!')=SUM\(A1:A10\)/);
  });

  it("preserves Korean text (UTF-8) unmangled", async () => {
    await createTestContract(ownerA.id, orgA.id, "한글 계약명 테스트 계약서");

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: {},
    });
    expect(result.csv).toContain("한글 계약명 테스트 계약서");
  });

  it("records an ANALYTICS_CSV_EXPORTED audit log with rowCount, without the CSV content itself", async () => {
    await createTestContract(ownerA.id, orgA.id, "감사로그 rowCount 테스트");

    const result = await exportAnalyticsCsv({
      userId: ownerA.id,
      organizationId: orgA.id,
      exportType: "portfolio",
      rawFilters: { contractType: "SERVICE" },
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId: orgA.id, action: "ANALYTICS_CSV_EXPORTED" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({
      exportType: "portfolio",
      filterKeys: ["contractType"],
      rowCount: result.rowCount,
    });
    expect(JSON.stringify(logs[0]!.metadata)).not.toContain("감사로그 rowCount 테스트");
  });

  it("supports all 5 export types without throwing", async () => {
    await createTestContract(ownerA.id, orgA.id, "전체 유형 스모크 테스트");
    for (const exportType of ["portfolio", "expiration", "clause-types", "review-signals", "counterparties"] as const) {
      const result = await exportAnalyticsCsv({ userId: ownerA.id, organizationId: orgA.id, exportType, rawFilters: {} });
      expect(result.csv.length).toBeGreaterThan(0);
      expect(result.filenameBase).toBeTruthy();
    }
  });

  it("rejects a user with no membership in the target organization", async () => {
    await expect(
      exportAnalyticsCsv({ userId: ownerA.id, organizationId: orgB.id, exportType: "portfolio", rawFilters: {} })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe("filter parity with the screen (§9 - same builder, never a separate CSV filter implementation)", () => {
    it("contractType filter narrows the exported portfolio CSV", async () => {
      await createTestContract(ownerA.id, orgA.id, "CSV 유형필터 SERVICE", { contractType: "SERVICE" });
      await createTestContract(ownerA.id, orgA.id, "CSV 유형필터 SUPPLY", { contractType: "SUPPLY" });

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "portfolio",
        rawFilters: { contractType: "SERVICE" },
      });
      expect(filtered.csv).toContain("CSV 유형필터 SERVICE");
      expect(filtered.csv).not.toContain("CSV 유형필터 SUPPLY");
    });

    it("displayStatus filter narrows the exported expiration CSV", async () => {
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 5);
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 5);
      await createTestContract(ownerA.id, orgA.id, "CSV 상태필터 만료됨", { endDate: past.toISOString().slice(0, 10) });
      await createTestContract(ownerA.id, orgA.id, "CSV 상태필터 만료예정", { endDate: future.toISOString().slice(0, 10) });

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "expiration",
        rawFilters: { displayStatus: "EXPIRED" },
      });
      expect(filtered.csv).toContain("CSV 상태필터 만료됨");
      expect(filtered.csv).not.toContain("CSV 상태필터 만료예정");
    });

    it("counterparty filter narrows the exported portfolio CSV", async () => {
      const counterparty = await createCounterparty({
        userId: ownerA.id,
        organizationId: orgA.id,
        input: { name: "CSV 상대방필터 대상" },
      });
      await createTestContract(ownerA.id, orgA.id, "CSV 상대방필터 연결됨", { counterpartyId: counterparty.id });
      await createTestContract(ownerA.id, orgA.id, "CSV 상대방필터 미연결");

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "portfolio",
        rawFilters: { counterpartyId: counterparty.id },
      });
      expect(filtered.csv).toContain("CSV 상대방필터 연결됨");
      expect(filtered.csv).not.toContain("CSV 상대방필터 미연결");

      await prisma.counterparty.delete({ where: { id: counterparty.id } });
    });

    it("currency filter narrows the exported portfolio CSV", async () => {
      await createTestContract(ownerA.id, orgA.id, "CSV 통화필터 USD", { currency: "USD", amount: "10" });
      await createTestContract(ownerA.id, orgA.id, "CSV 통화필터 KRW", { currency: "KRW", amount: "10000" });

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "portfolio",
        rawFilters: { currency: "USD" },
      });
      expect(filtered.csv).toContain("CSV 통화필터 USD");
      expect(filtered.csv).not.toContain("CSV 통화필터 KRW");
    });

    it("autoRenewal filter narrows the exported portfolio CSV", async () => {
      await createTestContract(ownerA.id, orgA.id, "CSV 자동갱신필터 O", { autoRenewal: true });
      await createTestContract(ownerA.id, orgA.id, "CSV 자동갱신필터 X", { autoRenewal: false });

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "portfolio",
        rawFilters: { autoRenewal: "true" },
      });
      expect(filtered.csv).toContain("CSV 자동갱신필터 O");
      expect(filtered.csv).not.toContain("CSV 자동갱신필터 X");
    });

    it("signal filters (signalStatus/signalType) narrow the exported review-signals CSV", async () => {
      const openContract = await createTestContract(ownerA.id, orgA.id, "CSV 신호필터 열림계약");
      const resolvedContract = await createTestContract(ownerA.id, orgA.id, "CSV 신호필터 완료계약");
      await prisma.clauseReviewSignal.create({
        data: {
          organizationId: orgA.id,
          contractId: openContract.id,
          signalType: "MANUAL_REVIEW",
          status: "OPEN",
          title: "테스트 신호",
          description: "테스트",
          ruleVersion: "test-v1",
          signalKey: `${openContract.id}-open`,
        },
      });
      await prisma.clauseReviewSignal.create({
        data: {
          organizationId: orgA.id,
          contractId: resolvedContract.id,
          signalType: "MANUAL_REVIEW",
          status: "RESOLVED",
          title: "테스트 신호",
          description: "테스트",
          ruleVersion: "test-v1",
          signalKey: `${resolvedContract.id}-resolved`,
        },
      });

      const filtered = await exportAnalyticsCsv({
        userId: ownerA.id,
        organizationId: orgA.id,
        exportType: "review-signals",
        rawFilters: { signalStatus: "RESOLVED" },
      });
      expect(filtered.csv).toContain("CSV 신호필터 완료계약");
      expect(filtered.csv).not.toContain("CSV 신호필터 열림계약");
    });

    it("the portfolio CSV and getPortfolioSummary see the exact same contract set for a given filter", async () => {
      await createTestContract(ownerA.id, orgA.id, "CSV-화면 일치 테스트", { contractType: "INVESTMENT" });

      const [csvResult, screenResult] = await Promise.all([
        exportAnalyticsCsv({
          userId: ownerA.id,
          organizationId: orgA.id,
          exportType: "portfolio",
          rawFilters: { contractType: "INVESTMENT" },
        }),
        getPortfolioSummary({ userId: ownerA.id, organizationId: orgA.id, filters: { contractType: "INVESTMENT" } }),
      ]);
      expect(csvResult.rowCount).toBe(screenResult.totalLive);
    });
  });
});
