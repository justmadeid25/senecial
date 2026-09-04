import "dotenv/config";

import { recoverStaleBatchExecutions } from "../src/server/batch/recover-stale-batch-executions";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Meant to run periodically alongside the rest of the worker scheduler -
 * recovers BatchExecution rows left stuck RUNNING by a worker/container
 * that died mid-job, which otherwise permanently poisons
 * /api/health/ready's `batch` check. Mirrors
 * scripts/recover-stale-mail-deliveries.ts exactly, including the
 * "instant" cadence (mutual exclusion only, no calendar window).
 */
async function main() {
  const outcome = await runBatchJob({
    jobName: "batch:recover-stale",
    cadence: "instant",
    run: async () => {
      const result = await recoverStaleBatchExecutions();
      return {
        processedCount: result.recoveredCount,
        successCount: result.recoveredCount,
        failureCount: 0,
      };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 다른 실행이 이미 진행 중입니다.");
    return;
  }
  console.log(`정체된 배치 실행 기록 복구 완료: ${outcome.result.processedCount}건 복구`);
}

main()
  .catch((error: unknown) => {
    console.error("정체 배치 실행 기록 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
