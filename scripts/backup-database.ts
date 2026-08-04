import "dotenv/config";

import { backupDatabase } from "../src/features/backup/server/backup-database";
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

/**
 * §9 - production execution requires an explicit `--force` flag (or
 * BACKUP_CONFIRM=true) instead of an interactive prompt, since this is
 * meant to run unattended from a scheduler.
 */
async function main() {
  const { outputDir, backupId, force } = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === "production" && !force && process.env.BACKUP_CONFIRM !== "true") {
    throw new Error(
      "운영 환경(NODE_ENV=production)에서 DB 백업을 실행하려면 --force 플래그 또는 BACKUP_CONFIRM=true 환경변수가 필요합니다."
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  const result = await backupDatabase({ outputDir, backupId, databaseUrl });
  console.log(`DB 백업 완료: ${result.backupId}`);
  console.log(`- 파일: ${result.databaseFile}`);
  console.log(`- checksum: ${result.databaseChecksum}`);
  console.log(`- manifest: ${result.manifestPath}`);
}

main()
  .catch((error: unknown) => {
    console.error("DB 백업 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
