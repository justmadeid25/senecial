import type { AppLogger } from "@/domain/logging/logger";
import { getLogger } from "@/server/logging";

export interface BatchHeartbeatLoopDeps {
  /** Injectable - normally touchBatchExecutionHeartbeat(). Returns whether the write actually applied (false once the row is no longer RUNNING). */
  touch: (executionId: string, now: Date) => Promise<boolean>;
  intervalMs: number;
  logger?: AppLogger;
  jobName?: string;
}

export interface BatchHeartbeatLoop {
  /** Cancels any pending tick and awaits the in-flight write (if any) before resolving - guarantees no further heartbeat write can start after stop() resolves. */
  stop(): Promise<void>;
}

/**
 * Self-rescheduling `setTimeout` (never `setInterval`): the next tick is
 * only scheduled after the previous write's promise has settled, so a
 * slow write can never overlap the next one - the same "await the run,
 * then schedule the next" idiom scripts/worker-scheduler.ts's own
 * loopJob() already uses for the outer scheduler loop, applied here one
 * level down for the heartbeat itself. A write that throws/rejects is
 * caught, logged, and does NOT stop the loop or propagate to the caller -
 * a transient heartbeat failure must never abort the actual business job
 * (see run-batch-job.ts). A write that resolves `false` means the row is
 * no longer RUNNING (recovered, or genuinely completed by some other
 * path) - the loop stops itself rather than continuing to write into a
 * terminal row forever.
 */
export function startBatchHeartbeatLoop(executionId: string, deps: BatchHeartbeatLoopDeps): BatchHeartbeatLoop {
  const logger = deps.logger ?? getLogger();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  function scheduleNext(): void {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      inFlight = tick();
      void inFlight.then(() => {
        if (!stopped) {
          scheduleNext();
        }
      });
    }, deps.intervalMs);
    timer.unref?.();
  }

  async function tick(): Promise<void> {
    try {
      const applied = await deps.touch(executionId, new Date());
      if (!applied) {
        // The row is no longer RUNNING (most likely recovered as stale, or
        // completed through some other path) - further heartbeat writes
        // would just keep no-opping against the status guard, so stop.
        stopped = true;
        logger.warn("batch.heartbeat_stopped_not_running", { executionId, jobName: deps.jobName });
      }
    } catch (error) {
      // Observable, never silent - but a transient write failure (a blip
      // in DB connectivity) must not abort the business job. If the DB is
      // down badly enough to fail every heartbeat write for the full
      // stale window, checkDatabase()/checkReadiness() already surfaces
      // that independently - see run-batch-job.ts's own docstring on this.
      logger.error("batch.heartbeat_write_failed", {
        executionId,
        jobName: deps.jobName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  scheduleNext();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
    },
  };
}
