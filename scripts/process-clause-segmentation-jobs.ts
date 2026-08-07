import "dotenv/config";
import { randomUUID } from "node:crypto";

import { processNextClauseSegmentationJob } from "../src/features/clauses/server/process-clause-segmentation-job";
import { CLAUSE_SEGMENTATION_BATCH_SIZE } from "../src/lib/config/clause-segmentation";
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
  return { limit: CLAUSE_SEGMENTATION_BATCH_SIZE };
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
 * Same shape as scripts/process-extraction-jobs.ts - claims and processes
 * jobs one at a time via processNextClauseSegmentationJob() (FOR UPDATE
 * SKIP LOCKED underneath, safe against concurrent worker invocations)
 * until either the batch limit is reached or there is nothing left to
 * claim. No public HTTP endpoint exposes this - CLI-only. Wrapped in
 * runBatchJob() with "instant" cadence, same rationale as
 * process-extraction-jobs.ts.
 */
async function main() {
  const { limit } = parseArgs();
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  console.log(`조항 분해 작업 처리 시작 (worker=${workerId}, db=${safeDatabaseTarget()}, limit=${limit})`);

  const outcome = await runBatchJob({
    jobName: "clauses:process",
    cadence: "instant",
    run: async () => {
      let processedCount = 0;
      for (let i = 0; i < limit; i += 1) {
        const result = await processNextClauseSegmentationJob(workerId);
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
    console.error("조항 분해 작업 처리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // §Phase 13.2 - same fix as scripts/process-embedding-jobs.ts: a
    // one-shot CLI must never depend on every transitive dependency
    // (a RATE_LIMITER=redis-driven singleton, in the sibling script's
    // confirmed case) remembering to close every connection it opens.
    process.exit(process.exitCode ?? 0);
  });
