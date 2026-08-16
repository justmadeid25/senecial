import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout as sleepWithSignal } from "node:timers/promises";

import { getLogger } from "../src/server/logging";
import { runCommand } from "../src/server/backup/run-command";
import { resolvePackageBinEntry } from "../src/server/process/resolve-package-bin";

/**
 * §Railway worker scheduling - a single always-on process that polls the
 * existing, UNMODIFIED batch scripts on independent per-job intervals,
 * each invoked as a real subprocess (exactly the same `pnpm run <script>`
 * shape already documented in docs/operations/batch-jobs.md's own cron
 * example - this file only decides WHEN to run each one, never HOW).
 *
 * Chosen over Railway native cron / per-job cron services: the upload
 * funnel (extraction -> chunk embedding -> segmentation -> clause
 * embedding) is a sequential chain where each stage's job is only created
 * once the prior stage finishes, so stacking independent per-job cron
 * intervals risks minutes of pure scheduling latency. A short poll
 * interval on one process collapses that to roughly the sum of actual
 * processing time. hourly/daily jobs are polled far less often but on the
 * SAME loop mechanism - the server-side calendar-window dedup
 * (domain/batch/execution-key.ts's buildExecutionKey) already makes an
 * extra check within the same hour/day a harmless no-op, so this never
 * needs a second scheduling authority.
 *
 * Deliberately NOT scheduled here (see the Railway scheduling activation
 * report for the full reasoning): mail:process / mail:recover-stale /
 * mail:recover-stale-token-deliveries (Postmark production approval still
 * unconfirmed - these can send real email once real deliveries exist) and
 * retention:scan / retention:purge (destructive, operator-only for the
 * first Closed Beta users per explicit instruction).
 */

interface ScheduledJob {
  /** Must match the npm script name exactly - this file never re-implements job logic. */
  script: string;
  pollIntervalMs: number;
  args?: string[];
}

const JOBS: ScheduledJob[] = [
  // Tier A - high-frequency queue-draining (the upload-funnel chain).
  { script: "extraction:process", pollIntervalMs: 5_000 },
  { script: "clauses:process", pollIntervalMs: 5_000 },
  { script: "ai:process-embeddings", pollIntervalMs: 5_000 },
  { script: "ai:process-chunk-embeddings", pollIntervalMs: 5_000 },

  // Tier B - stale-job recovery, needs to run often but not as tight as A.
  { script: "extraction:recover-stale", pollIntervalMs: 30_000 },
  { script: "clauses:recover-stale", pollIntervalMs: 30_000 },
  { script: "ai:recover-stale-embeddings", pollIntervalMs: 30_000 },
  { script: "ai:scan-stale-embeddings", pollIntervalMs: 60_000 },
  { script: "clauses:generate-signals", pollIntervalMs: 60_000 },

  // Read-only diagnostic, documented cadence 5-15min - never sends mail.
  { script: "mail:scan-stale-token-deliveries", pollIntervalMs: 10 * 60_000 },

  // Tier C/D - hourly/daily maintenance, polled more often than their
  // cadence for simplicity; server-side window dedup makes extra checks
  // a no-op.
  { script: "files:reconcile", pollIntervalMs: 5 * 60_000 },
  { script: "files:find-orphans", pollIntervalMs: 15 * 60_000 },
  { script: "notifications:generate", pollIntervalMs: 15 * 60_000 },
];

const logger = getLogger();
let shuttingDown = false;
const activeRuns = new Set<Promise<void>>();
/** Aborts every in-progress sleep() immediately on shutdown, instead of
 * letting each job loop block until its own (up to 15-minute) poll
 * interval naturally elapses - real bug found via `docker stop`: without
 * this, the container never exited on its own and always hit Docker's
 * SIGKILL grace-period timeout. */
const shutdownSignal = new AbortController();

async function sleep(ms: number): Promise<void> {
  try {
    await sleepWithSignal(ms, undefined, { signal: shutdownSignal.signal });
  } catch {
    // Aborted by shutdown - the caller's `if (shuttingDown) break` handles it.
  }
}

async function runJobOnce(job: ScheduledJob): Promise<void> {
  const runId = randomUUID();
  const start = Date.now();
  logger.info("worker_scheduler.job_started", { job: job.script, runId });

  try {
    const result = await runCommand(
      process.execPath,
      [resolvePackageBinEntry("tsx"), `scripts/${scriptFileFor(job.script)}`, ...(job.args ?? [])],
      {}
    );
    const durationMs = Date.now() - start;
    if (result.exitCode === 0) {
      logger.info("worker_scheduler.job_succeeded", { job: job.script, runId, durationMs });
    } else {
      logger.error("worker_scheduler.job_failed", {
        job: job.script,
        runId,
        durationMs,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
      });
    }
  } catch (error) {
    logger.error("worker_scheduler.job_crashed", {
      job: job.script,
      runId,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** package.json script name -> its script file, since npm scripts can't be spawned as a bare binary without pnpm/npm's own resolution overhead per tick. */
const SCRIPT_FILES: Record<string, string> = {
  "extraction:process": "process-extraction-jobs.ts",
  "extraction:recover-stale": "recover-stale-extraction-jobs.ts",
  "clauses:process": "process-clause-segmentation-jobs.ts",
  "clauses:recover-stale": "recover-stale-clause-jobs.ts",
  "clauses:generate-signals": "generate-clause-review-signals.ts",
  "ai:process-embeddings": "process-embedding-jobs.ts",
  "ai:process-chunk-embeddings": "process-document-chunk-embedding-jobs.ts",
  "ai:recover-stale-embeddings": "recover-stale-embedding-jobs.ts",
  "ai:scan-stale-embeddings": "scan-stale-embeddings.ts",
  "mail:scan-stale-token-deliveries": "scan-stale-token-deliveries.ts",
  "files:reconcile": "reconcile-deleted-files.ts",
  "files:find-orphans": "find-orphan-files.ts",
  "notifications:generate": "generate-notifications.ts",
};

function scriptFileFor(script: string): string {
  const file = SCRIPT_FILES[script];
  if (!file) {
    throw new Error(`알 수 없는 스케줄 작업입니다: ${script}`);
  }
  return file;
}

/**
 * Self-rescheduling loop (not setInterval) - waits for the PREVIOUS run to
 * fully finish before scheduling the next one, so a run that takes longer
 * than its poll interval never overlaps itself. The DB-level advisory
 * lock / row claim already prevents overlap too, but this avoids wasteful
 * subprocess spawns when the previous invocation is still holding it.
 */
async function loopJob(job: ScheduledJob): Promise<void> {
  while (!shuttingDown) {
    const run = runJobOnce(job);
    activeRuns.add(run);
    await run;
    activeRuns.delete(run);
    if (shuttingDown) break;
    await sleep(job.pollIntervalMs);
  }
}

async function main() {
  logger.info("worker_scheduler.started", { jobCount: JOBS.length, jobs: JOBS.map((j) => j.script).join(",") });

  const loops = JOBS.map((job) => loopJob(job));

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker_scheduler.shutdown_requested", { signal, activeRuns: activeRuns.size });
    shutdownSignal.abort();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await Promise.all(loops);
  logger.info("worker_scheduler.stopped", {});
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error("worker_scheduler.fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
