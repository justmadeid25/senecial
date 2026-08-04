import "dotenv/config";

import { RETENTION_PURGE_BATCH_SIZE } from "../src/lib/config/retention";
import { executePurgeJobs } from "../src/features/retention/server/execute-purge-jobs";
import { purgeSimpleEntities } from "../src/features/retention/server/purge-simple-entities";
import { scanPurgeCandidates } from "../src/features/retention/server/scan-purge-candidates";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : RETENTION_PURGE_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got "${limitArg}"`);
  }
  return { dryRun, force, limit };
}

/**
 * `--dry-run`: preview only, guaranteed not to write anything - does not
 * even register DataPurgeJob rows (uses `scanPurgeCandidates(now, false)`)
 * and deliberately bypasses runBatchJob() entirely (no lock, no
 * BatchExecution row) since it has zero side effects to serialize against.
 *
 * Without `--dry-run`: wrapped in runBatchJob() with "hourly" cadence -
 * purges up to `--limit` contracts (via DataPurgeJob, idempotent/
 * retry-safe) and, in the same run, purges every eligible
 * invitation/notification/terminally-failed job directly (already
 * idempotent single-table deletes - see purge-simple-entities.ts).
 *
 * Never prints contract/clause content, file storageKeys, full email
 * addresses, or DATABASE_URL (§7).
 */
async function main() {
  const { dryRun, force, limit } = parseArgs(process.argv.slice(2));
  const now = new Date();

  if (dryRun) {
    const preview = await scanPurgeCandidates(now, false);
    console.log("[dry-run] 아무것도 삭제하거나 기록하지 않습니다.");
    console.log(
      `- 계약: 대상 ${preview.contracts.eligibleCount}건 (조직 ${preview.contracts.organizationCount}개), ` +
        `예상 파일 ${preview.contracts.estimatedFileCount}건, 예상 조항 ${preview.contracts.estimatedClauseCount}건`
    );
    console.log(`- 초대: 대상 ${preview.invitations.eligibleCount}건`);
    console.log(`- 알림: 대상 ${preview.notifications.eligibleCount}건`);
    console.log(
      `- 실패한 작업: 추출 ${preview.failedJobs.extractionJobs}건, 조항 분해 ${preview.failedJobs.segmentationJobs}건`
    );
    return;
  }

  const outcome = await runBatchJob({
    jobName: "retention:purge",
    cadence: "hourly",
    now,
    force,
    run: async () => {
      const contractResult = await executePurgeJobs(limit, now);
      console.log(
        `계약 purge: 처리 대상 ${contractResult.claimed}건, 성공 ${contractResult.purged}건, ` +
          `파일 대기 ${contractResult.filesPending}건(재시도 예정), 실패 ${contractResult.failed}건`
      );

      const simpleResult = await purgeSimpleEntities(now);
      console.log(
        `단순 항목 purge: 초대 ${simpleResult.invitationsDeleted}건, 알림 ${simpleResult.notificationsDeleted}건, ` +
          `추출 작업 ${simpleResult.extractionJobsDeleted}건, 조항 분해 작업 ${simpleResult.segmentationJobsDeleted}건 삭제`
      );

      return {
        processedCount: contractResult.claimed,
        successCount: contractResult.purged,
        failureCount: contractResult.filesPending + contractResult.failed,
      };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 이번 시간대에 이미 실행되었습니다. (재실행하려면 --force)");
  }
}

main()
  .catch((error: unknown) => {
    console.error("보존 정책 purge 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
