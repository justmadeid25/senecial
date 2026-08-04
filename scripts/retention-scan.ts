import "dotenv/config";

import { scanPurgeCandidates } from "../src/features/retention/server/scan-purge-candidates";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Registers (upserts) a PENDING DataPurgeJob for every currently
 * purge-eligible contract and prints a counts-only summary for every
 * retention category - never contract/clause content, file storageKeys,
 * full email addresses, or the DATABASE_URL (Phase 9 §7). Wrapped in
 * runBatchJob() with "daily" cadence - scanning more than once a day adds
 * no value (registerPurgeJob() is already idempotent, so this is not
 * about correctness, just avoiding redundant scans).
 */
async function main() {
  const force = process.argv.includes("--force");

  const outcome = await runBatchJob({
    jobName: "retention:scan",
    cadence: "daily",
    force,
    run: async () => {
      const summary = await scanPurgeCandidates(new Date(), true);

      console.log("보존 정책 스캔 결과:");
      console.log(
        `- 계약: 대상 ${summary.contracts.eligibleCount}건 (조직 ${summary.contracts.organizationCount}개), ` +
          `예상 파일 ${summary.contracts.estimatedFileCount}건, 예상 조항 ${summary.contracts.estimatedClauseCount}건, ` +
          `예상 추출 작업 ${summary.contracts.estimatedExtractionJobCount}건 - purge job ${summary.contracts.registeredJobCount}건 등록됨`
      );
      console.log(`- 초대: 대상 ${summary.invitations.eligibleCount}건`);
      console.log(`- 알림: 대상 ${summary.notifications.eligibleCount}건`);
      console.log(
        `- 실패한 작업: 추출 ${summary.failedJobs.extractionJobs}건, 조항 분해 ${summary.failedJobs.segmentationJobs}건`
      );

      return {
        processedCount: summary.contracts.eligibleCount,
        successCount: summary.contracts.registeredJobCount ?? 0,
        failureCount: 0,
      };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 오늘 이미 실행되었습니다. (재실행하려면 --force)");
  }
}

main()
  .catch((error: unknown) => {
    console.error("보존 정책 스캔 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
