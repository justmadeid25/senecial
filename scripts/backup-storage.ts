import "dotenv/config";

import { backupStorage } from "../src/features/backup/server/backup-storage";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const outputArg = argv.find((arg) => arg.startsWith("--output="));
  const backupIdArg = argv.find((arg) => arg.startsWith("--backup-id="));
  const force = argv.includes("--force");
  return {
    outputDir: outputArg ? outputArg.slice("--output=".length) : process.env.BACKUP_OUTPUT_DIR ?? "./backups",
    backupId: backupIdArg ? backupIdArg.slice("--backup-id=".length) : undefined,
    force,
  };
}

async function main() {
  const { outputDir, backupId, force } = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === "production" && !force && process.env.BACKUP_CONFIRM !== "true") {
    throw new Error(
      "운영 환경(NODE_ENV=production)에서 storage 백업을 실행하려면 --force 플래그 또는 BACKUP_CONFIRM=true 환경변수가 필요합니다."
    );
  }

  const storageRoot = process.env.LOCAL_STORAGE_PATH ?? "./storage";
  const result = await backupStorage({ outputDir, backupId, storageRoot });
  console.log(`storage 백업 완료: ${result.backupId}`);
  console.log(`- 파일: ${result.storageArchive}`);
  console.log(`- checksum: ${result.storageChecksum}`);
  console.log(`- 파일 수: ${result.fileCount}`);
  console.log(`- manifest: ${result.manifestPath}`);
}

main()
  .catch((error: unknown) => {
    console.error("storage 백업 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
