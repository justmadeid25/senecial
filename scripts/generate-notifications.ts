import "dotenv/config";

import { generateContractNotifications } from "../src/features/notifications/server/generate-contract-notifications";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

/**
 * Meant to run once per day via an external scheduler (cron, GitHub
 * Actions, Vercel Cron, a queue worker, ...) - see README's "스케줄 실행
 * 구조" section. This script is the only trusted entry point into
 * generateContractNotifications(); there is deliberately no HTTP endpoint
 * for it. Wrapped in runBatchJob() with "daily" cadence so two scheduler
 * triggers on the same day never both run (Phase 9 §27/§28). `--force`
 * bypasses that same-day dedup for a deliberate manual re-run (the
 * underlying generation logic is independently idempotent via
 * Notification's `eventKey` unique constraint, so this is always safe).
 */
async function main() {
  const force = process.argv.includes("--force");

  const outcome = await runBatchJob({
    jobName: "notifications:generate",
    cadence: "daily",
    force,
    run: async () => {
      const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
      const now = new Date();

      let totalCreated = 0;
      for (const organization of organizations) {
        const result = await generateContractNotifications({ organizationId: organization.id, now });
        totalCreated += result.notificationsCreated;
        console.log(
          `[${organization.name}] ${result.contractsScanned}개 계약 확인, 알림 ${result.notificationsCreated}건 생성`
        );
      }

      return { processedCount: organizations.length, successCount: totalCreated, failureCount: 0 };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 오늘 이미 실행되었습니다. (재실행하려면 --force)");
    return;
  }
  console.log(`완료: 조직 ${outcome.result.processedCount}곳, 총 알림 ${outcome.result.successCount}건 생성`);
}

main()
  .catch((error: unknown) => {
    console.error("알림 생성 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
