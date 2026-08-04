import "dotenv/config";

import { migrateStorageToS3 } from "../src/features/contract-files/server/migrate-storage-to-s3";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  return {
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    limit: limitArg ? Number(limitArg.slice("--limit=".length)) : undefined,
  };
}

/**
 * Phase 10A §35 - migrates ContractFile rows from local disk to S3 in
 * bounded batches (default 100/run - pass --limit=N to change). Never
 * deletes local files (see migrateStorageToS3()'s docstring); local
 * cleanup is a deliberately separate, manual step performed only after
 * independently confirming migration is complete and verified.
 *
 * Re-run repeatedly (with --resume once a prior run may have been
 * interrupted mid-batch) until the summary reports hasMore=false. Not
 * wrapped in runBatchJob() - unlike the daily/hourly recurring jobs
 * elsewhere in this codebase, this is an operator-driven, explicitly
 * repeated procedure, not a scheduled cadence.
 */
async function main() {
  const { dryRun, resume, limit } = parseArgs(process.argv.slice(2));

  // Note: this reads S3_* env vars directly regardless of the currently
  // ACTIVE `FILE_STORAGE_DRIVER` - migration's destination is always S3
  // config, whether or not S3 is (yet) the org's default driver for new
  // uploads. `resolveS3Config()` (called inside migrateStorageToS3())
  // throws a clear error if those variables are not set.
  const result = await migrateStorageToS3({ dryRun, resume, limit });

  console.log(
    `${dryRun ? "[dry-run] " : ""}대상 ${result.scanned}건 처리: ` +
      `마이그레이션 ${result.migrated}건, 이미 존재(재확인만) ${result.skipped}건, 실패 ${result.failed}건`
  );

  if (result.failed > 0) {
    console.log("실패한 항목:");
    for (const row of result.rows) {
      if (row.status === "failed") {
        console.log(`  - fileId=${row.fileId}: ${row.detail}`);
      }
    }
  }

  if (result.hasMore) {
    console.log("아직 마이그레이션할 파일이 더 있습니다 - 이 스크립트를 다시 실행하십시오 (필요시 --resume 사용).");
  } else if (!dryRun) {
    console.log("더 이상 마이그레이션 대상이 없습니다.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("S3 마이그레이션 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
