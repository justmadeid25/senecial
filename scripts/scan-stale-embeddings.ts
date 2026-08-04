import "dotenv/config";

import { scanAndEnqueueStaleClauseEmbeddings } from "../src/features/ai/server/enqueue-embedding-jobs";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * §Embedding Pipeline - "조항 수정 → embedding stale → queue 생성" as a
 * standalone, schedulable scan (in addition to the automatic enqueue
 * hook in process-clause-segmentation-job.ts) - a safety net that
 * catches any clause whose embedding never got enqueued for any reason
 * (a past bug, a manual DB fix, ...).
 */
async function main() {
  const force = process.argv.includes("--force");

  const outcome = await runBatchJob({
    jobName: "ai:scan-stale-embeddings",
    cadence: "daily",
    force,
    run: async () => {
      const result = await scanAndEnqueueStaleClauseEmbeddings();
      console.log(`정체 임베딩 스캔 결과: 조항 ${result.scanned}건 검사, ${result.enqueued}건 새로 큐에 등록됨`);
      return { processedCount: result.scanned, successCount: result.enqueued, failureCount: 0 };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 오늘 이미 실행되었습니다. (재실행하려면 --force)");
  }
}

main()
  .catch((error: unknown) => {
    console.error("정체 임베딩 스캔 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
