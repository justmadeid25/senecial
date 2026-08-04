import "dotenv/config";

import { recoverStaleEmbeddingJobs } from "../src/features/ai/server/recover-stale-embedding-jobs";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

async function main() {
  const outcome = await runBatchJob({
    jobName: "ai:recover-stale-embeddings",
    cadence: "instant",
    run: async () => {
      const result = await recoverStaleEmbeddingJobs();
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
  console.log(`정체된 임베딩 작업 확인 완료: ${processedCount}건 확인, PENDING 복구 ${successCount}건, FAILED 처리 ${failureCount}건`);
}

main()
  .catch((error: unknown) => {
    console.error("정체 임베딩 작업 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
