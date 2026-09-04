/**
 * Single source of truth for BatchExecution heartbeat timing - shared by
 * three components that all MUST agree on these exact numbers:
 *  - the automatic heartbeat loop runBatchJob() starts for every execution
 *    (src/server/batch/batch-heartbeat-loop.ts) - writes on
 *    BATCH_HEARTBEAT_INTERVAL_MS
 *  - the read side (checkBatch() in check-readiness.ts, surfaced via
 *    /api/health/ready) - reads on STALE_BATCH_HEARTBEAT_MINUTES
 *  - the write side (recoverStaleBatchExecutions()) - the actual row
 *    transition, also on STALE_BATCH_HEARTBEAT_MINUTES
 *
 * If the read/write stale threshold and the write-side heartbeat interval
 * diverge, that's not internal bookkeeping - it changes observable
 * health/recovery semantics (a row the health check considers stale could
 * go un-recovered forever, or vice versa; a heartbeat interval too close
 * to the stale threshold turns ordinary scheduling jitter into false-
 * positive orphan recovery of a perfectly healthy job).
 */
export const STALE_BATCH_HEARTBEAT_MINUTES = 30;

/**
 * How often runBatchJob()'s automatic heartbeat loop refreshes
 * heartbeatAt for the execution it owns, for as long as the awaited job
 * body is still running. Chosen well below the stale threshold (see the
 * invariant below) so ordinary event-loop/scheduling jitter, or a single
 * missed write retried on the next tick, can never look like an orphaned
 * process - see batch-heartbeat-loop.ts for the actual refresh mechanism.
 */
export const BATCH_HEARTBEAT_INTERVAL_MINUTES = 5;

export const STALE_BATCH_HEARTBEAT_MS = STALE_BATCH_HEARTBEAT_MINUTES * 60 * 1000;
export const BATCH_HEARTBEAT_INTERVAL_MS = BATCH_HEARTBEAT_INTERVAL_MINUTES * 60 * 1000;

/**
 * A heartbeat interval that isn't comfortably below the stale threshold
 * defeats the entire point of a heartbeat - it stops being a liveness
 * signal and starts being a coin flip. Enforced at import time (this
 * module has no side effects otherwise, so importing it is always safe)
 * rather than left as a comment, since the two constants above are
 * trivial to edit independently without noticing the relationship this
 * comment describes.
 */
if (BATCH_HEARTBEAT_INTERVAL_MINUTES * 3 > STALE_BATCH_HEARTBEAT_MINUTES) {
  throw new Error(
    `BATCH_HEARTBEAT_INTERVAL_MINUTES (${BATCH_HEARTBEAT_INTERVAL_MINUTES}) must be at most 1/3 of ` +
      `STALE_BATCH_HEARTBEAT_MINUTES (${STALE_BATCH_HEARTBEAT_MINUTES}) - otherwise a single missed ` +
      `heartbeat tick could make a perfectly healthy job look orphaned.`
  );
}
