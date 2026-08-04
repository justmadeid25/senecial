import "dotenv/config";

import {
  checkE2eStorageEmpty,
  checkNoInProgressBatchExecution,
  checkNoLeftoverNodeProcesses,
  checkNoOrphanPortListener,
  checkNoTestOrganizations,
  checkRedisPrefixClean,
  checkTestMailboxEmpty,
  type EnvironmentCheckResult,
} from "./lib/e2e-environment-checks";

/**
 * §Phase 12.4 §8 - `pnpm test:e2e:verify-cleanup`. Run AFTER a full E2E
 * pass (Stage 1/2/3) to confirm the suite left no state behind: this is
 * the thing that turns "the tests passed" into "the tests passed AND
 * cleaned up after themselves" - a suite that leaves orphan orgs/keys/
 * processes behind can make the NEXT run's failures look like new bugs
 * when they are really contamination from this one. A cleanup failure
 * fails the suite (non-zero exit), same severity as a test failure.
 */
async function main(): Promise<void> {
  const port = process.env.E2E_PROD_PORT ?? "3300";
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  if (!databaseUrl) {
    console.error("[verify-cleanup] DATABASE_URL이 설정되지 않았습니다.");
    process.exitCode = 1;
    return;
  }

  console.log("[verify-cleanup] E2E 실행 후 정리 상태 검증 시작...");

  const results: EnvironmentCheckResult[] = [
    await checkNoTestOrganizations(databaseUrl),
    await checkE2eStorageEmpty(),
    await checkRedisPrefixClean(redisUrl),
    await checkTestMailboxEmpty(),
    await checkNoInProgressBatchExecution(databaseUrl),
    await checkNoOrphanPortListener(port),
    await checkNoLeftoverNodeProcesses(process.pid),
  ];

  let allOk = true;
  for (const result of results) {
    const icon = result.ok ? "OK  " : "FAIL";
    console.log(`[verify-cleanup] [${icon}] ${result.name}: ${result.detail}`);
    if (!result.ok) allOk = false;
  }

  if (!allOk) {
    console.error("\n[verify-cleanup] 실패 - 정리되지 않은 상태가 남아 있습니다. Suite를 실패로 처리하십시오.");
    process.exitCode = 1;
    return;
  }

  console.log("\n[verify-cleanup] 모든 검사 통과 - 실행 후 잔여 상태 없음.");
}

main().catch((error: unknown) => {
  console.error("[verify-cleanup] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
