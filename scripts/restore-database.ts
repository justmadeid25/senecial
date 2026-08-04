import "dotenv/config";

import { restoreDatabase } from "../src/features/backup/server/restore-database";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const manifestArg = argv.find((arg) => arg.startsWith("--manifest="));
  const targetArg = argv.find((arg) => arg.startsWith("--target-database-url="));
  if (!manifestArg || !targetArg) {
    throw new Error("사용법: restore-database.ts --manifest=<path> --target-database-url=<url> [--allow-overwrite] [--allow-production-overwrite]");
  }
  return {
    manifestPath: manifestArg.slice("--manifest=".length),
    targetDatabaseUrl: targetArg.slice("--target-database-url=".length),
    allowOverwrite: argv.includes("--allow-overwrite"),
    allowProductionOverwrite: argv.includes("--allow-production-overwrite"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await restoreDatabase({
    manifestPath: args.manifestPath,
    targetDatabaseUrl: args.targetDatabaseUrl,
    primaryDatabaseUrl: process.env.DATABASE_URL,
    isProduction: process.env.NODE_ENV === "production",
    allowProductionOverwrite: args.allowProductionOverwrite,
    allowOverwrite: args.allowOverwrite,
  });

  console.log(`DB 복원 완료: ${result.backupId}`);
  console.log(`- manifest의 migration: ${result.manifestMigration}`);
  console.log(`- 복원된 DB의 migration: ${result.restoredMigration ?? "(확인 불가)"}`);
  if (!result.migrationMatches) {
    console.warn("경고: 복원된 DB의 마지막 migration이 manifest와 일치하지 않습니다.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("DB 복원 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
