import "dotenv/config";
import { randomUUID } from "node:crypto";

import { processNextEmbeddingJob } from "../src/features/ai/server/process-embedding-job";
import { prisma } from "../src/server/db/client";

const DEFAULT_BATCH_SIZE = 50;

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2);
  if (args.includes("--once")) {
    return { limit: 1 };
  }
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  return { limit: parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_BATCH_SIZE };
}

/**
 * §Embedding Job - claims and processes jobs one at a time via
 * processNextEmbeddingJob() (FOR UPDATE SKIP LOCKED, safe against
 * concurrent worker invocations) until either the batch limit is reached
 * or there is nothing left to claim. No public HTTP endpoint - CLI-only,
 * same shape as scripts/process-extraction-jobs.ts.
 */
async function main() {
  const { limit } = parseArgs();
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  console.log(`임베딩 작업 처리 시작 (worker=${workerId}, limit=${limit})`);

  let processedCount = 0;
  for (let i = 0; i < limit; i += 1) {
    const result = await processNextEmbeddingJob(workerId);
    if (!result.processed) {
      break;
    }
    processedCount += 1;
  }

  console.log(`임베딩 작업 처리 완료: ${processedCount}건 처리됨`);
}

main()
  .catch((error: unknown) => {
    console.error("임베딩 작업 처리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
