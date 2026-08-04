import "dotenv/config";

import { restoreStorage } from "../src/features/backup/server/restore-storage";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const manifestArg = argv.find((arg) => arg.startsWith("--manifest="));
  const targetArg = argv.find((arg) => arg.startsWith("--target-dir="));
  if (!manifestArg || !targetArg) {
    throw new Error("사용법: restore-storage.ts --manifest=<path> --target-dir=<dir> [--allow-overwrite]");
  }
  return {
    manifestPath: manifestArg.slice("--manifest=".length),
    targetDir: targetArg.slice("--target-dir=".length),
    allowOverwrite: argv.includes("--allow-overwrite"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await restoreStorage(args);

  console.log(`storage 복원 완료: ${result.backupId}`);
  console.log(`- 복원된 파일 수: ${result.restoredFileCount} (manifest: ${result.manifestFileCount})`);
  if (!result.fileCountMatches) {
    console.warn("경고: 복원된 파일 수가 manifest와 일치하지 않습니다.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("storage 복원 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
