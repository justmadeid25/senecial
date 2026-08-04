import "dotenv/config";

import { acquireAdvisoryLock } from "../src/server/batch/advisory-lock";
import { getLogger } from "../src/server/logging";
import { runCommand } from "../src/server/backup/run-command";
import { resolvePackageBinEntry } from "../src/server/process/resolve-package-bin";

const MIGRATE_DEPLOY_LOCK_KEY = "clausebase:deploy-migrate";

/**
 * Phase 11 Part C - the ONLY sanctioned way to apply migrations to a real
 * (staging/production) database - always `prisma migrate deploy`, NEVER
 * `prisma migrate dev` (which can prompt interactively and will happily
 * generate a brand-new migration file from schema drift instead of just
 * replaying already-committed ones - exactly what must never happen
 * against a real database).
 *
 * §migration lock - Prisma's own migration engine already takes an
 * internal advisory lock during `migrate deploy` (guards the actual DDL),
 * but this wraps a SEPARATE, app-level Postgres advisory lock
 * (server/batch/advisory-lock.ts - the same primitive BatchExecution jobs
 * use, session-scoped, auto-released if this process dies) around the
 * whole deploy step. This is what lets two independent deploy pipelines
 * running at once (e.g. a human re-running this by hand while a
 * concurrency-misconfigured CI job also fires) fail loudly and
 * immediately with a clear message, rather than relying solely on
 * Prisma's own internal lock behavior (which is real but not this
 * script's own visible, documented contract - staging-deploy.yml's
 * `concurrency: {group: staging-deploy}` is the primary defense; this is
 * defense-in-depth for anyone invoking the script directly, outside that
 * pipeline).
 */
async function main() {
  const logger = getLogger();
  const lock = await acquireAdvisoryLock(MIGRATE_DEPLOY_LOCK_KEY);

  if (!lock.acquired) {
    logger.error("deploy_migrate.locked", {
      detail: "다른 migrate deploy가 이미 진행 중입니다 - 동시 실행을 방지하기 위해 즉시 종료합니다.",
    });
    console.error("다른 migrate deploy가 이미 진행 중입니다. 잠시 후 다시 시도하십시오.");
    process.exitCode = 1;
    return;
  }

  try {
    logger.info("deploy_migrate.started", {});
    const start = Date.now();

    const result = await runCommand(process.execPath, [resolvePackageBinEntry("prisma"), "migrate", "deploy"]);

    const durationMs = Date.now() - start;
    if (result.exitCode !== 0) {
      logger.error("deploy_migrate.failed", { exitCode: result.exitCode, durationMs });
      console.error(`prisma migrate deploy 실패 (exit ${result.exitCode}):\n${result.stderr}`);
      process.exitCode = result.exitCode;
      return;
    }

    logger.info("deploy_migrate.succeeded", { durationMs });
    console.log(`migrate deploy 완료 (${durationMs}ms)`);
  } finally {
    await lock.release();
  }
}

main().catch((error: unknown) => {
  console.error("deploy:migrate 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
