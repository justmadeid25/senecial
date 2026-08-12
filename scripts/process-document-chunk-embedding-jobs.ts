import "dotenv/config";
import { randomUUID } from "node:crypto";

import { processNextChunkEmbeddingJob } from "../src/features/ai/server/process-document-chunk-embedding-job";
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
 * §Phase 14.1 - mirrors scripts/process-embedding-jobs.ts exactly, for
 * ContractDocumentChunkEmbeddingJob. No public HTTP endpoint - CLI-only.
 */
async function main() {
  const { limit } = parseArgs();
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  console.log(`문서 청크 임베딩 작업 처리 시작 (worker=${workerId}, limit=${limit})`);

  let processedCount = 0;
  for (let i = 0; i < limit; i += 1) {
    const result = await processNextChunkEmbeddingJob(workerId);
    if (!result.processed) {
      break;
    }
    processedCount += 1;
  }

  console.log(`문서 청크 임베딩 작업 처리 완료: ${processedCount}건 처리됨`);
}

main()
  .catch((error: unknown) => {
    console.error("문서 청크 임베딩 작업 처리 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Same real-incident fix as process-embedding-jobs.ts - budget
    // reservation opens a real Redis client (RATE_LIMITER=redis)
    // regardless of embedding provider, which nothing otherwise closes.
    process.exit(process.exitCode ?? 0);
  });
