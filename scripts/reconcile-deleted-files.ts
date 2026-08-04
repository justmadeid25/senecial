import "dotenv/config";

import { reconcileDeletedFiles } from "../src/features/contract-files/server/reconcile-deleted-files";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Meant to run periodically (e.g. hourly via cron) to clean up physical
 * files left behind after a ContractFile soft-delete's immediate physical
 * delete step failed - see delete-contract-file.ts's ordering rationale.
 * Idempotent: a file already gone from storage reconciles as a success on
 * its next retry (LocalStorageDriver.delete() treats "already missing" as
 * success). Wrapped in runBatchJob() with "hourly" cadence (Phase 9
 * §27/§28).
 */
async function main() {
  const force = process.argv.includes("--force");

  const outcome = await runBatchJob({
    jobName: "files:reconcile",
    cadence: "hourly",
    force,
    run: async () => {
      const result = await reconcileDeletedFiles();
      return {
        processedCount: result.scanned,
        successCount: result.succeeded,
        failureCount: result.failed,
      };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 이번 시간대에 이미 실행되었습니다. (재실행하려면 --force)");
    return;
  }

  const { processedCount, successCount, failureCount } = outcome.result;
  console.log(`파일 삭제 재조정 완료: ${processedCount}건 확인, 성공 ${successCount}건, 실패 ${failureCount}건`);
  if (failureCount > 0) {
    console.warn(`${failureCount}건은 다음 실행에서 재시도됩니다 (최대 재시도 횟수 이내인 경우).`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("파일 삭제 재조정 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
