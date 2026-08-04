import "dotenv/config";

import { recoverStaleExtractionJobs } from "../src/features/extraction/server/recover-stale-extraction-jobs";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Meant to run periodically (e.g. every few minutes via cron) alongside
 * the extraction worker - recovers PROCESSING jobs whose worker likely
 * died mid-run. Idempotent: a job already recovered on a previous run no
 * longer matches the "stale PROCESSING" query. Wrapped in runBatchJob()
 * with "instant" cadence (mutual exclusion only, no calendar window) -
 * "hourly" would wrongly block the frequent re-invocations this job is
 * actually meant to have.
 */
async function main() {
  const outcome = await runBatchJob({
    jobName: "extraction:recover-stale",
    cadence: "instant",
    run: async () => {
      const result = await recoverStaleExtractionJobs();
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
  console.log(`정체된 추출 작업 확인 완료: ${processedCount}건 확인, PENDING 복구 ${successCount}건, FAILED 처리 ${failureCount}건`);
}

main()
  .catch((error: unknown) => {
    console.error("정체 작업 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
