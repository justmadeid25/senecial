import "dotenv/config";

import { maskStorageKey } from "../src/domain/storage/mask-storage-key";
import { findOrphanFiles } from "../src/features/contract-files/server/find-orphan-files";
import { runBatchJob } from "../src/server/batch/run-batch-job";
import { prisma } from "../src/server/db/client";
import type { StorageProvider } from "../src/server/storage";

/**
 * Read-only detection only - this script never deletes anything, with or
 * without --dry-run (that flag is accepted for a clear invocation and to
 * signal intent, but actual deletion of confirmed orphans is not
 * implemented in this phase - see README). Wrapped in runBatchJob() with
 * "daily" cadence - a full storage scan is not something that needs (or
 * should) run more than once a day.
 *
 * Phase 10A §12 - never prints a full storageKey, originalName, contract
 * title, or bucket/endpoint - only a masked prefix/suffix of each orphan
 * key (see maskStorageKey()).
 */
async function main() {
  const force = process.argv.includes("--force");
  const rawProvider = process.argv.find((arg) => arg.startsWith("--provider="))?.slice("--provider=".length);
  if (rawProvider && rawProvider !== "local" && rawProvider !== "s3") {
    throw new Error(`--provider는 local 또는 s3만 지원합니다 (받은 값: ${rawProvider})`);
  }
  const providerArg: StorageProvider | undefined = rawProvider as StorageProvider | undefined;

  const outcome = await runBatchJob({
    jobName: `files:find-orphans${providerArg ? `:${providerArg}` : ""}`,
    cadence: "daily",
    force,
    run: async () => {
      const result = await findOrphanFiles({ provider: providerArg });
      console.log(`물리 파일 ${result.physicalKeyCount}개, DB row ${result.dbRowCount}개 확인.`);
      if (result.truncated) {
        console.warn(
          "경고: 스캔 대상이 너무 많아 일부만 확인했습니다 (ORPHAN_SCAN_MAX_OBJECTS 초과) - 다시 실행하면 이어서 확인됩니다."
        );
      }

      if (result.orphanKeys.length === 0) {
        console.log("고아 파일이 없습니다.");
      } else {
        console.log(`고아 파일(DB에 대응하는 row가 없는 물리 파일) ${result.orphanKeys.length}개 발견:`);
        for (const key of result.orphanKeys) {
          console.log(`  - ${maskStorageKey(key)}`);
        }
        console.log(
          "이 스크립트는 조회만 수행합니다 - 실제 삭제는 이번 Phase에서 구현되어 있지 않으니, 위 목록을 검토한 뒤 수동으로 처리하십시오."
        );
      }

      return { processedCount: result.physicalKeyCount, successCount: result.orphanKeys.length, failureCount: 0 };
    },
  });

  if (outcome.skipped) {
    console.log("건너뜀: 이미 다른 실행이 진행 중이거나 오늘 이미 실행되었습니다. (재실행하려면 --force)");
  }
}

main()
  .catch((error: unknown) => {
    console.error("고아 파일 탐지 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
