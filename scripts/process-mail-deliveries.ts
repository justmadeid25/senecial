import "dotenv/config";
import { randomUUID } from "node:crypto";

import { processNextMailDelivery } from "../src/features/mail/server/process-next-mail-delivery";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

const DEFAULT_BATCH_SIZE = 20;

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  if (once) {
    return { limit: 1 };
  }
  if (parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0) {
    return { limit: parsedLimit };
  }
  return { limit: DEFAULT_BATCH_SIZE };
}

/**
 * Phase 10B section 13 - claims and processes PENDING MailDelivery rows
 * one at a time via processNextMailDelivery() (itself claiming via `FOR
 * UPDATE SKIP LOCKED`, safe against concurrent worker invocations) until
 * either the batch limit is reached or there is nothing left to claim.
 * Only ever finds PASSWORD_CHANGED rows in practice - see
 * worker-handled-message-types.ts. Wrapped in runBatchJob() with
 * "instant" cadence, mirroring scripts/process-extraction-jobs.ts exactly
 * (mutual exclusion only, meant to run frequently via cron/scheduler).
 */
async function main() {
  const { limit } = parseArgs();
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  console.log(`메일 전송 처리 시작 (worker=${workerId}, limit=${limit})`);

  const outcome = await runBatchJob({
    jobName: "mail:process",
    cadence: "instant",
    run: async () => {
      let processedCount = 0;
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < limit; i += 1) {
        const result = await processNextMailDelivery(workerId);
        if (!result.processed) {
          break;
        }
        processedCount += 1;
        if (result.outcome === "sent") {
          successCount += 1;
        } else if (result.outcome === "failed") {
          failureCount += 1;
        }
        console.log(`처리 완료: mailDeliveryId=${result.mailDeliveryId}, outcome=${result.outcome}`);
      }

      return { processedCount, successCount, failureCount };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 다른 워커가 이미 처리 중입니다.");
    return;
  }
  console.log(
    `완료: ${outcome.result.processedCount}건 처리 (성공 ${outcome.result.successCount}, 실패 ${outcome.result.failureCount})`
  );
}

main()
  .catch((error: unknown) => {
    console.error("메일 전송 처리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
