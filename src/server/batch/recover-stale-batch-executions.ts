import { STALE_BATCH_HEARTBEAT_MINUTES } from "@/domain/batch/batch-heartbeat-timing";
import { getLogger } from "@/server/logging";
import { prisma } from "@/server/db/client";

/** Distinguishes an orphan-recovered row from a real application-level batch failure in errorCode. */
const ORPHANED_ERROR_CODE = "ORPHANED_STALE_HEARTBEAT";

export interface RecoverStaleBatchExecutionsResult {
  recoveredCount: number;
  recoveredIds: string[];
}

/**
 * runBatchJob()'s own BatchExecution row has no equivalent to the
 * Postgres session-level advisory lock's automatic release-on-crash
 * behavior (see advisory-lock.ts's docstring: the LOCK self-heals when a
 * worker dies mid-job - a fresh invocation can always re-acquire it and
 * run again - but the RUNNING row it created is a plain table row with no
 * such property). If the whole process is killed (container restart,
 * OOM, deploy) between `createRunningBatchExecution()` and
 * `markBatchExecutionSucceeded()`/`markBatchExecutionFailed()`, that row
 * stays RUNNING forever - nothing else in this codebase ever revisits it -
 * and checkBatch() (src/features/health/server/check-readiness.ts) reports
 * `batch: error` (so overall /api/health/ready reports 503) permanently
 * from that point on, even though the job itself is otherwise completely
 * healthy and successfully re-running on schedule.
 *
 * This is the recover-stale counterpart for that gap, following the exact
 * same shape as recoverStaleMailDeliveries()/recoverStaleExtractionJobs():
 * a single atomic `UPDATE ... WHERE status='RUNNING' AND heartbeatAt <
 * cutoff ... RETURNING id` - the condition-check and the transition happen
 * in one statement, so this is safe to call from multiple concurrent
 * workers/replicas without any separate SELECT-then-UPDATE race window. A
 * row that receives a fresh heartbeat, completes normally, or was already
 * recovered by a concurrent call in between simply stops matching the
 * WHERE clause and is left untouched - this never overwrites a row that
 * is genuinely still RUNNING, nor one already SUCCEEDED/FAILED. Uses `<`
 * (not `<=`) for the cutoff comparison to match checkBatch()'s own `lt`
 * filter exactly, so a row exactly at the threshold is treated identically
 * by both the read side and this recovery.
 *
 * Recovered rows transition to the existing FAILED terminal state (no new
 * schema/status needed) with errorCode=ORPHANED_STALE_HEARTBEAT, so they
 * remain distinguishable in `batch_executions` history from a genuine
 * application-level failure without inventing a new column.
 */
export async function recoverStaleBatchExecutions(
  staleMinutes: number = STALE_BATCH_HEARTBEAT_MINUTES,
  now: Date = new Date()
): Promise<RecoverStaleBatchExecutionsResult> {
  const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);

  const recovered = await prisma.$queryRaw<Array<{ id: string; jobName: string }>>`
    UPDATE "batch_executions"
    SET "status" = 'FAILED',
        "completedAt" = now(),
        "errorCode" = ${ORPHANED_ERROR_CODE}
    WHERE "status" = 'RUNNING' AND "heartbeatAt" < ${staleBefore}
    RETURNING "id", "jobName"
  `;

  if (recovered.length > 0) {
    getLogger().info("batch.stale_recovered", {
      count: recovered.length,
      ids: recovered.map((row) => row.id).join(","),
      jobNames: recovered.map((row) => row.jobName).join(","),
    });
  }

  return { recoveredCount: recovered.length, recoveredIds: recovered.map((row) => row.id) };
}
