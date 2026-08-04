import "dotenv/config";

import { getClauseTypeAnalytics } from "../src/features/analytics/server/get-clause-type-analytics";
import { getContractTypeAnalytics } from "../src/features/analytics/server/get-contract-type-analytics";
import { getCounterpartyAnalytics } from "../src/features/analytics/server/get-counterparty-analytics";
import { getExpirationDistribution } from "../src/features/analytics/server/get-expiration-distribution";
import { getMonthlyTrends } from "../src/features/analytics/server/get-monthly-trends";
import { getPortfolioSummary } from "../src/features/analytics/server/get-portfolio-summary";
import { getReviewSignalAnalytics } from "../src/features/analytics/server/get-review-signal-analytics";
import { prisma } from "../src/server/db/client";

/**
 * §25/§36 - measures the analytics query services against whatever data
 * currently exists in the "clausebase-analytics-perf" organization (see
 * scripts/seed-analytics-performance-data.ts). Development-use only; not
 * part of the automated test suite (query timing is environment-dependent
 * and not a meaningful pass/fail assertion).
 */

async function timeIt<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - start;
  console.log(`${label}: ${elapsedMs.toFixed(0)}ms`);
  return result;
}

async function main() {
  const organization = await prisma.organization.findUnique({
    where: { slug: "clausebase-analytics-perf" },
    select: { id: true },
  });
  if (!organization) {
    console.error(
      'Performance-test organization not found. Run "pnpm analytics:seed-performance" first.'
    );
    process.exitCode = 1;
    return;
  }

  const owner = await prisma.membership.findFirst({
    where: { organizationId: organization.id, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) {
    console.error("Performance-test organization has no OWNER membership.");
    process.exitCode = 1;
    return;
  }

  const [contracts, clauses, signals] = await Promise.all([
    prisma.contract.count({ where: { organizationId: organization.id, deletedAt: null } }),
    prisma.contractClause.count({ where: { organizationId: organization.id } }),
    prisma.clauseReviewSignal.count({ where: { organizationId: organization.id } }),
  ]);
  console.log(`Data scale: ${contracts} contracts, ${clauses} clauses, ${signals} review signals.\n`);

  const params = { userId: owner.userId, organizationId: organization.id };

  await timeIt("getPortfolioSummary", () => getPortfolioSummary(params));
  await timeIt("getExpirationDistribution", () => getExpirationDistribution(params));
  await timeIt("getContractTypeAnalytics", () => getContractTypeAnalytics(params));
  await timeIt("getClauseTypeAnalytics", () => getClauseTypeAnalytics(params));
  await timeIt("getReviewSignalAnalytics", () => getReviewSignalAnalytics(params));
  await timeIt("getCounterpartyAnalytics", () => getCounterpartyAnalytics(params));
  await timeIt("getMonthlyTrends", () => getMonthlyTrends(params));

  // §13 - composite filter combinations, measured against the same
  // large-scale dataset (never a separate, smaller fixture).
  const sampleCounterparty = await prisma.counterparty.findFirst({
    where: { organizationId: organization.id, deletedAt: null },
    select: { id: true },
  });

  console.log("\nComposite filter combinations (§13):");
  await timeIt("getPortfolioSummary(contractType+displayStatus)", () =>
    getPortfolioSummary({ ...params, filters: { contractType: "SERVICE", displayStatus: "ACTIVE" } })
  );
  if (sampleCounterparty) {
    await timeIt("getCounterpartyAnalytics(counterparty+currency)", () =>
      getCounterpartyAnalytics({ ...params, filters: { counterpartyId: sampleCounterparty.id, currency: "KRW" } })
    );
  }
  await timeIt("getExpirationDistribution(autoRenewal+period)", () =>
    getExpirationDistribution({
      ...params,
      filters: { autoRenewal: true, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31") },
    })
  );
  await timeIt("getReviewSignalAnalytics(clauseType+signalStatus+signalType)", () =>
    getReviewSignalAnalytics({
      ...params,
      filters: { clauseType: "PAYMENT", signalStatus: "OPEN", signalType: "MANUAL_REVIEW" },
    })
  );
}

main()
  .catch((error: unknown) => {
    console.error("Benchmark failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
