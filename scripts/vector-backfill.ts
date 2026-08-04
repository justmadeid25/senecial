import "dotenv/config";

import {
  dryRunVectorBackfill,
  runVectorBackfill,
  verifyVectorBackfill,
} from "../src/features/ai/server/run-vector-backfill";
import { prisma } from "../src/server/db/client";

const DEFAULT_LIMIT = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verify = args.includes("--verify");
  // §Phase 12.1 §7 - --resume is not a distinct code path: the underlying
  // query (findVectorBackfillCandidates) always selects whatever rows
  // still lack a native vector, so simply re-running is already a resume.
  // The flag exists for operator clarity only (an explicit "I know this
  // was interrupted before" signal in a deploy script / runbook).
  const resume = args.includes("--resume");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;
  return { dryRun, verify, resume, limit };
}

/**
 * §Phase 12.1 §7 - `pnpm ai:vector-backfill`. Populates
 * ClauseEmbedding.vectorNative (the real pgvector column) from the
 * existing application-level `vector` Float[] fallback - never the other
 * way around, and never deletes/modifies the fallback column itself.
 */
async function main() {
  const { dryRun, verify, resume, limit } = parseArgs();

  if (verify) {
    const result = await verifyVectorBackfill();
    console.log(
      `검증 결과: 이전 가능 ${result.stats.totalEligible}건, 이전 완료 ${result.stats.populated}건, ` +
        `차원 불일치로 이전 불가 ${result.stats.stale}건`
    );
    console.log(`샘플 ${result.sampledCount}건 검증 (float32 반올림 오차 허용), 불일치 ${result.mismatches.length}건`);
    if (result.mismatches.length > 0) {
      for (const mismatch of result.mismatches) {
        console.log(`  - 불일치: ${mismatch.id} (최대 절대 오차 ${mismatch.maxAbsDiff})`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (dryRun) {
    const result = await dryRunVectorBackfill();
    console.log(
      `[dry-run] 이번 실행에서 이전할 대상: ${result.eligibleBefore}건 ` +
        `(전체 이전 가능 ${result.stats.totalEligible}건, 이미 완료 ${result.stats.populated}건, ` +
        `차원 불일치로 이전 불가 ${result.stats.stale}건)`
    );
    return;
  }

  console.log(`벡터 백필 시작 (limit=${limit}${resume ? ", --resume" : ""})`);
  const result = await runVectorBackfill({ limit });
  console.log(
    `이전 대상 ${result.eligibleBefore}건 중 ${result.processed}건 처리 - 성공 ${result.succeeded}건, 실패 ${result.failed.length}건`
  );
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.log(`  - 실패: ${failure.id} (${failure.reason})`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("벡터 백필 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
