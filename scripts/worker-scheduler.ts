import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout as sleepWithSignal } from "node:timers/promises";

import { getLogger } from "../src/server/logging";
import { runCommand } from "../src/server/backup/run-command";
import { resolvePackageBinEntry } from "../src/server/process/resolve-package-bin";

import { JOBS, type ScheduledJob, scriptFileFor } from "./worker-scheduler-jobs";

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
 * mail:process was added 2026-08-19 once Postmark production approval was
 * confirmed (see the Railway scheduling activation report) - it only ever
 * sends PASSWORD_CHANGED notices (docs/operations/batch-jobs.md), at that
 * doc's documented "매 1~5분" cadence.
 *
 * mail:recover-stale was added alongside the Closed Beta P0 release-path
 * fixes - it repairs SENDING MailDelivery rows (PASSWORD_CHANGED only, the
 * one message type this worker's mail:process handles) left stuck by a
 * worker crash mid-send. Same idempotent scan-then-classify shape as the
 * other Tier B recovery jobs, no new scheduling mechanism required.
 *
 * Deliberately NOT scheduled here: mail:recover-stale-token-deliveries
 * (still pending the same activation decision - it rotates live
 * invitation/verification tokens and is being kept a manual operator step
 * for the first Closed Beta users) and retention:scan / retention:purge
 * (destructive, operator-only for the first Closed Beta users per explicit
 * instruction).
 */

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
