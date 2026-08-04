import "dotenv/config";

import {
  checkDedicatedE2eDatabase,
  checkE2eStorageEmpty,
  checkNoLeftoverNodeProcesses,
  checkNoPostgresContention,
  checkPortFree,
  checkRedisPrefixClean,
  checkTestMailboxEmpty,
  cleanupE2eStorage,
  cleanupRedisPrefix,
  cleanupTestMailbox,
  type EnvironmentCheckResult,
} from "./lib/e2e-environment-checks";

/**
 * §Phase 12.4 §1 - `pnpm test:e2e:preflight`. Run ALONE, before any
 * production-like E2E stage, in an environment with no other heavy job
 * (AI evaluation, benchmark, backup/restore drill, another Playwright
 * suite, large seed, migration generation, another dev server) running
 * concurrently - Phase 12.3's Run 2 was measurably degraded by exactly
 * this kind of self-inflicted contention, which this script exists to
 * catch BEFORE a run starts rather than explain away AFTER one fails.
 *
 * Never silently proceeds on failure - any failed check exits non-zero
 * and the caller (`run-e2e-prod.ts` / CI) must not start Playwright.
 * Auto-remediates only the two things that are always safe to clear
 * automatically (disposable Redis E2E-prefixed keys, stale E2E storage
 * directories) - everything else is report-only, since blindly killing
 * "suspicious" processes or terminating live Postgres queries could
 * destroy a human's unrelated work.
 */
async function main(): Promise<void> {
  const port = process.env.E2E_PROD_PORT ?? "3300";
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  if (!databaseUrl) {
    console.error("[preflight] DATABASE_URL이 설정되지 않았습니다 - .env.e2e를 통해 실행되었는지 확인하십시오.");
    process.exitCode = 1;
    return;
  }

  console.log("[preflight] Senecial E2E 환경 사전 점검 시작...");

  const results: EnvironmentCheckResult[] = [];
  results.push(await checkPortFree(port));
  results.push(await checkDedicatedE2eDatabase(databaseUrl));
  results.push(await checkNoPostgresContention(databaseUrl));
  results.push(await checkE2eStorageEmpty());
  results.push(await checkTestMailboxEmpty());
  results.push(await checkRedisPrefixClean(redisUrl));
  results.push(await checkNoLeftoverNodeProcesses(process.pid));

  // §1 - auto-remediate three checks whose leftovers are ALWAYS disposable
  // per-run scratch data (Redis E2E-prefixed keys, tmp/e2e-storage
  // directories, .test-mailbox files) rather than block a run on them -
  // everything else (port, DB, Postgres contention, other processes)
  // stays report-only since auto-fixing those could destroy unrelated
  // work or mask a real problem.
  async function remediate(name: string, cleanup: () => Promise<number>, recheck: () => Promise<EnvironmentCheckResult>): Promise<void> {
    const check = results.find((r) => r.name === name);
    if (!check || check.ok) return;
    const count = await cleanup();
    console.log(`[preflight] ${name}: 잔여 항목 ${count}건 자동 정리함 - 재검사...`);
    results[results.indexOf(check)] = await recheck();
  }

  await remediate("Redis E2E prefix 정리됨", () => cleanupRedisPrefix(redisUrl), () => checkRedisPrefixClean(redisUrl));
  await remediate("E2E storage 비어 있음", cleanupE2eStorage, checkE2eStorageEmpty);
  await remediate("test mailbox 비어 있음", cleanupTestMailbox, checkTestMailboxEmpty);

  let allOk = true;
  for (const result of results) {
    const icon = result.ok ? "OK  " : "FAIL";
    console.log(`[preflight] [${icon}] ${result.name}: ${result.detail}`);
    if (!result.ok) allOk = false;
  }

  if (!allOk) {
    console.error("\n[preflight] 실패 - 위 문제를 해결한 뒤 다시 실행하십시오. E2E를 시작하지 않습니다.");
    process.exitCode = 1;
    return;
  }

  console.log("\n[preflight] 모든 검사 통과 - E2E 실행을 시작해도 안전합니다.");
}

main().catch((error: unknown) => {
  console.error("[preflight] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
