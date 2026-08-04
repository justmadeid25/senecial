/**
 * §27/§28 - "instant" jobs (queue-drainers meant to run frequently, e.g.
 * every minute, where claimNextPendingJob()'s own `FOR UPDATE SKIP
 * LOCKED` already makes concurrent claims safe at the row level) only
 * need true mutual exclusion - never two overlapping invocations of the
 * SAME job at once, but any number of sequential invocations over time.
 * "hourly"/"daily" jobs are meant to run at most once per that calendar
 * window (matching the prompt's own
 * "notifications:generate:2026-07-30" / "files:reconcile:2026-07-30T01"
 * examples) - a second scheduler trigger within the same window is a
 * duplicate, not a legitimate re-run.
 */
export type BatchCadence = "instant" | "hourly" | "daily";

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isoHour(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/**
 * The Postgres advisory lock key - "instant" cadence locks on the job
 * name alone (whoever holds it blocks everyone else until they finish,
 * regardless of calendar time), so this is NOT what should also be used
 * as BatchExecution.executionKey (see buildExecutionKey() below) since a
 * bare job name would violate the model's `@@unique(executionKey)` on the
 * very next invocation.
 */
export function buildLockKey(jobName: string, cadence: BatchCadence, now: Date): string {
  if (cadence === "instant") {
    return jobName;
  }
  return cadence === "hourly" ? `${jobName}:${isoHour(now)}` : `${jobName}:${isoDate(now)}`;
}

/**
 * The BatchExecution.executionKey - always unique per actual invocation
 * for "instant" cadence (a timestamp suffix), and equal to the window
 * itself for "hourly"/"daily" cadence, where it doubles as a second,
 * DB-constraint-enforced duplicate-prevention layer on top of the
 * advisory lock (the lock only protects against a *concurrent* second
 * start; the unique constraint also catches a *sequential* second start
 * within the same window, e.g. from a scheduler retry after the first run
 * already completed and released its lock).
 */
export function buildExecutionKey(jobName: string, cadence: BatchCadence, now: Date): string {
  if (cadence === "instant") {
    return `${jobName}:${now.toISOString()}`;
  }
  return buildLockKey(jobName, cadence, now);
}
