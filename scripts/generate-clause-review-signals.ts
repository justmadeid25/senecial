import "dotenv/config";

import { generateClauseReviewSignals } from "../src/features/clauses/server/generate-clause-review-signals";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Same organization-iteration shape as scripts/generate-notifications.ts -
 * this is the only trusted entry point into generateClauseReviewSignals();
 * there is deliberately no HTTP endpoint for it. Safe to run repeatedly
 * (duplicate signals are skipped via the signalKey unique constraint) -
 * wrapped in runBatchJob() with "instant" cadence so it can still be
 * scheduled frequently without a windowed dedup key blocking it.
 */
async function main() {
  const outcome = await runBatchJob({
    jobName: "clauses:generate-signals",
    cadence: "instant",
    run: async () => {
      const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });

      let totalCreated = 0;
      for (const organization of organizations) {
        const result = await generateClauseReviewSignals({ organizationId: organization.id });
        totalCreated += result.signalsCreated;
        console.log(
          `[${organization.name}] 계약 ${result.contractsScanned}건 확인, 검토 신호 ${result.signalsCreated}건 생성`
        );
      }

      return { processedCount: organizations.length, successCount: totalCreated, failureCount: 0 };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 다른 실행이 이미 진행 중입니다.");
    return;
  }
  console.log(`완료: 조직 ${outcome.result.processedCount}곳, 총 검토 신호 ${outcome.result.successCount}건 생성`);
}

main()
  .catch((error: unknown) => {
    console.error("검토 신호 생성 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
