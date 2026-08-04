import "dotenv/config";

import { verifyRestore } from "../src/features/backup/server/verify-restore";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const manifestArg = argv.find((arg) => arg.startsWith("--manifest="));
  const targetDbArg = argv.find((arg) => arg.startsWith("--target-database-url="));
  const targetStorageArg = argv.find((arg) => arg.startsWith("--target-storage-dir="));
  if (!manifestArg) {
    throw new Error("사용법: verify-restore.ts --manifest=<path> [--target-database-url=<url>] [--target-storage-dir=<dir>]");
  }
  return {
    manifestPath: manifestArg.slice("--manifest=".length),
    targetDatabaseUrl: targetDbArg?.slice("--target-database-url=".length),
    targetStorageDir: targetStorageArg?.slice("--target-storage-dir=".length),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyRestore(args);

  console.log("복구 검증 결과:");
  for (const check of result.checks) {
    console.log(`- [${check.passed ? "OK" : "FAIL"}] ${check.name}: ${check.detail}`);
  }

  if (!result.allPassed) {
    console.error("복구 검증 실패: 위 항목 중 하나 이상 실패했습니다.");
    process.exitCode = 1;
  } else {
    console.log("모든 검증 항목 통과.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("복구 검증 실행 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
