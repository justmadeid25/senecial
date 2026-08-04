import { randomUUID } from "node:crypto";
import os from "node:os";

import { buildExecutionKey, buildLockKey, type BatchCadence } from "@/domain/batch/execution-key";
import { getLogger } from "@/server/logging";
import { recordBatchDuration } from "@/server/monitoring/metrics";
import { acquireAdvisoryLock } from "./advisory-lock";
import {
  createRunningBatchExecution,
  markBatchExecutionFailed,
  markBatchExecutionSucceeded,
  touchBatchExecutionHeartbeat,
} from "@/server/repositories/batch-execution-repository";
import { isUniqueConstraintViolation } from "@/server/db/prisma-errors";
import { toSafeBatchErrorCode } from "./safe-error-code";

export interface BatchJobCounts {
  processedCount?: number;
  successCount?: number;
  failureCount?: number;
}

export interface BatchJobContext {
  heartbeat(): Promise<void>;
}

export interface RunBatchJobParams<T extends BatchJobCounts> {
  jobName: string;
  cadence: BatchCadence;
  now?: Date;
  /**
   * Bypasses the hourly/daily windowed dedup (BatchExecution's
   * @@unique(executionKey)) for one deliberate, manual re-run - e.g. an
   * operator re-triggering `notifications:generate` after fixing a data
   * issue, same day, or an E2E/integration test that needs a fresh run
   * regardless of what already ran earlier that day. Does NOT bypass the
   * advisory lock - a forced run still cannot overlap a currently-running
   * instance of the same job. Every underlying job body in this codebase
   * is independently idempotent (dedup via a unique key on the row it
   * creates - eventKey, signalKey, etc.), so forcing a re-run is always
   * safe, just potentially redundant. Never the default - CLI callers
   * must pass an explicit `--force` flag to set this (§28's "명시적
   * override" pattern, same as ALLOW_* production guards elsewhere in
   * this Phase).
   */
  force?: boolean;
  run: (ctx: BatchJobContext) => Promise<T>;
}

export type RunBatchJobResult<T> = { skipped: true } | { skipped: false; executionId: string; result: T };

/**
 * §27-29 - the common wrapper every CLI batch script routes through:
 *
 *  1. environment check - DATABASE_URL must be set (the same check
 *     prisma/db/client.ts already enforces on first query, made explicit
 *     here so a misconfigured environment fails before acquiring a lock).
 *  2. Postgres advisory lock, keyed by cadence (see execution-key.ts) -
 *     the PRIMARY defense against two schedulers starting the same job
 *     concurrently. A lock miss means another instance is already
 *     running (or, for hourly/daily cadence, already ran this window) -
 *     `{skipped: true}` is returned, never an error.
 *  3. BatchExecution row (status RUNNING) - a SECOND, DB-constraint-backed
 *     defense (`@@unique(executionKey)`) against a sequential duplicate
 *     within the same window, plus the durable history/heartbeat record
 *     §48 asks for.
 *  4. structured log at start/success/failure (§31).
 *  5. `ctx.heartbeat()` available to long-running jobs.
 *  6. job body (`run`) executed.
 *  7/8. processed/success/failure counts recorded.
 *  9. RUNNING -> SUCCEEDED or FAILED (errorCode only, never the raw
 *     exception message - see safe-error-code.ts).
 *  10. lock released, always (finally).
 *
 * Never logs contract/clause text, tokens, passwords, or DATABASE_URL -
 * only jobName/executionKey/counts/errorCode.
 */
export async function runBatchJob<T extends BatchJobCounts>(
  params: RunBatchJobParams<T>
): Promise<RunBatchJobResult<T>> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  const now = params.now ?? new Date();
  const logger = getLogger();
  const lockKey = buildLockKey(params.jobName, params.cadence, now);
  // A forced run always gets its own unique executionKey (never the bare
  // window key) so it can never collide with - or block - a normal
  // scheduled run's own BatchExecution row for that same window.
  const executionKey = params.force
    ? `${buildExecutionKey(params.jobName, params.cadence, now)}:forced:${randomUUID()}`
    : buildExecutionKey(params.jobName, params.cadence, now);
  const lockedBy = `${os.hostname()}-${process.pid}`;

  const lock = await acquireAdvisoryLock(lockKey);
  if (!lock.acquired) {
    logger.info("batch.skipped_locked", { jobName: params.jobName, lockKey });
    return { skipped: true };
  }

  try {
    const execution = await createRunningBatchExecution({
      jobName: params.jobName,
      executionKey,
      startedAt: now,
      lockedBy,
    }).catch((error: unknown) => {
      if (isUniqueConstraintViolation(error, "executionKey")) {
        return null;
      }
      throw error;
    });

    if (!execution) {
      logger.info("batch.skipped_duplicate_window", { jobName: params.jobName, executionKey });
      return { skipped: true };
    }

    logger.info("batch.started", { jobName: params.jobName, executionKey, executionId: execution.id });

    try {
      const result = await params.run({
        heartbeat: () => touchBatchExecutionHeartbeat(execution.id, new Date()),
      });

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - now.getTime();
      await markBatchExecutionSucceeded(execution.id, {
        completedAt,
        processedCount: result.processedCount ?? 0,
        successCount: result.successCount ?? 0,
        failureCount: result.failureCount ?? 0,
      });
      recordBatchDuration(params.jobName, durationMs);

      logger.info("batch.succeeded", {
        jobName: params.jobName,
        executionId: execution.id,
        processedCount: result.processedCount ?? 0,
        durationMs,
      });

      return { skipped: false, executionId: execution.id, result };
    } catch (error) {
      const errorCode = toSafeBatchErrorCode(error);
      await markBatchExecutionFailed(execution.id, {
        completedAt: new Date(),
        errorCode,
        processedCount: 0,
        successCount: 0,
        failureCount: 0,
      });
      recordBatchDuration(params.jobName, Date.now() - now.getTime());
      logger.error("batch.failed", { jobName: params.jobName, executionId: execution.id, errorCode });
      throw error;
    }
  } finally {
    await lock.release();
  }
}
