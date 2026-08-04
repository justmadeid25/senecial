import "dotenv/config";
import { randomUUID } from "node:crypto";

import { processNextExtractionJob } from "../src/features/extraction/server/process-extraction-job";
import { EXTRACTION_BATCH_SIZE } from "../src/lib/config/extraction";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";

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
  return { limit: EXTRACTION_BATCH_SIZE };
}

/** Never prints the full DATABASE_URL (which embeds the password) - only host/port/database name. */
function safeDatabaseTarget(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return "(DATABASE_URL not set)";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

/**
 * Claims and processes jobs one at a time via processNextExtractionJob()
 * (which itself claims via FOR UPDATE SKIP LOCKED, safe against concurrent
 * worker invocations) until either the batch limit is reached or there is
 * nothing left to claim. `--once` processes exactly one job - the
 * preferred mode for external schedulers (cron, a queue trigger) calling
 * this repeatedly, rather than running as a long-lived daemon. No public
 * HTTP endpoint exposes this - it is CLI-only.
 *
 * Wrapped in runBatchJob() with "instant" cadence (Phase 9 §27/§28): this
 * job is meant to run frequently (e.g. every minute), so the goal is only
 * true mutual exclusion (never two invocations processing at once, which
 * `FOR UPDATE SKIP LOCKED` already makes safe at the row level anyway -
 * this adds an extra, cheaper guard before even attempting a claim) - not
 * "once per calendar window" the way notifications:generate/files:reconcile
 * are.
 */
async function main() {
  const { limit } = parseArgs();
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  console.log(`추출 작업 처리 시작 (worker=${workerId}, db=${safeDatabaseTarget()}, limit=${limit})`);

  const outcome = await runBatchJob({
    jobName: "extraction:process",
    cadence: "instant",
    run: async () => {
      let processedCount = 0;
      for (let i = 0; i < limit; i += 1) {
        const result = await processNextExtractionJob(workerId);
        if (!result.processed) {
          break;
        }
        processedCount += 1;
        console.log(`처리 완료: job=${result.jobId}`);
      }
      return { processedCount, successCount: processedCount, failureCount: 0 };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 다른 워커가 이미 처리 중입니다.");
    return;
  }
  console.log(`완료: ${outcome.result.processedCount}건 처리`);
}

main()
  .catch((error: unknown) => {
    console.error("추출 작업 처리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
