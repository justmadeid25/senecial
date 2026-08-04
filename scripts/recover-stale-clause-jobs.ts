import "dotenv/config";

import { recoverStaleClauseSegmentationJobs } from "../src/features/clauses/server/recover-stale-clause-segmentation-jobs";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Same shape as scripts/recover-stale-extraction-jobs.ts - meant to run
 * periodically (e.g. every few minutes) alongside the clause segmentation
 * worker, recovering PROCESSING jobs whose worker likely died mid-run.
 * Idempotent. Wrapped in runBatchJob() with "instant" cadence (mutual
 * exclusion only) - same rationale as extraction:recover-stale.
 */
async function main() {
  const outcome = await runBatchJob({
    jobName: "clauses:recover-stale",
    cadence: "instant",
    run: async () => {
      const result = await recoverStaleClauseSegmentationJobs();
      return {
        processedCount: result.scanned,
        successCount: result.recoveredToPending,
        failureCount: result.failed,
      };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 다른 실행이 이미 진행 중입니다.");
    return;
  }
  const { processedCount, successCount, failureCount } = outcome.result;
  console.log(`정체된 조항 분해 작업 확인 완료: ${processedCount}건 확인, PENDING 복구 ${successCount}건, FAILED 처리 ${failureCount}건`);
}

main()
  .catch((error: unknown) => {
    console.error("정체 작업 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
