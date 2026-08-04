import "dotenv/config";

import { recoverStaleMailDeliveries } from "../src/features/mail/server/recover-stale-mail-deliveries";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Meant to run periodically alongside the mail worker - recovers SENDING
 * MailDelivery rows whose worker likely died mid-send. Mirrors
 * scripts/recover-stale-extraction-jobs.ts exactly, including the
 * "instant" cadence (mutual exclusion only, no calendar window - this is
 * meant to be re-invoked frequently).
 */
async function main() {
  const outcome = await runBatchJob({
    jobName: "mail:recover-stale",
    cadence: "instant",
    run: async () => {
      const result = await recoverStaleMailDeliveries();
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
  console.log(`정체된 메일 전송 확인 완료: ${processedCount}건 확인, PENDING 복구 ${successCount}건, FAILED 처리 ${failureCount}건`);
}

main()
  .catch((error: unknown) => {
    console.error("정체 메일 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
