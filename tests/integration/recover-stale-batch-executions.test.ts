import { afterAll, describe, expect, it } from "vitest";

import { checkReadiness } from "@/features/health/server/check-readiness";
import { startBatchHeartbeatLoop } from "@/server/batch/batch-heartbeat-loop";
import { recoverStaleBatchExecutions } from "@/server/batch/recover-stale-batch-executions";
import { runBatchJob } from "@/server/batch/run-batch-job";
import { prisma } from "@/server/db/client";
import {
  markBatchExecutionFailed,
  markBatchExecutionSucceeded,
  touchBatchExecutionHeartbeat,
} from "@/server/repositories/batch-execution-repository";

const JOB_PREFIX = "test:recover-stale-batch";
const createdIds: string[] = [];

afterAll(async () => {
  await prisma.batchExecution.deleteMany({ where: { id: { in: createdIds } } });
});

function uniqueExecutionKey(suffix: string): string {
  return `${JOB_PREFIX}:${suffix}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createExecution(overrides: {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  heartbeatAt: Date;
  startedAt?: Date;
  completedAt?: Date | null;
  jobName?: string;
}) {
  const row = await prisma.batchExecution.create({
    data: {
      jobName: overrides.jobName ?? `${JOB_PREFIX}:job`,
      executionKey: uniqueExecutionKey(overrides.jobName ?? "job"),
      status: overrides.status,
      startedAt: overrides.startedAt ?? overrides.heartbeatAt,
      heartbeatAt: overrides.heartbeatAt,
      completedAt: overrides.completedAt ?? null,
      lockedBy: "test-worker",
    },
  });
  createdIds.push(row.id);
  return row;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe("recoverStaleBatchExecutions", () => {
  it("recovers a stale RUNNING row (heartbeat well past the 30-minute threshold) to FAILED with the orphan errorCode", async () => {
    const stale = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).toContain(stale.id);
    const row = await prisma.batchExecution.findUniqueOrThrow({ where: { id: stale.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
    expect(row.completedAt).not.toBeNull();
  });

  it("does NOT touch an active RUNNING row whose heartbeat is recent", async () => {
    const active = await createExecution({ status: "RUNNING", heartbeatAt: new Date() });

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).not.toContain(active.id);
    const row = await prisma.batchExecution.findUniqueOrThrow({ where: { id: active.id } });
    expect(row.status).toBe("RUNNING");
    expect(row.errorCode).toBeNull();
  });

  it("does NOT touch an already-SUCCEEDED row, even with an old heartbeat", async () => {
    const succeeded = await createExecution({
      status: "SUCCEEDED",
      heartbeatAt: new Date(Date.now() - HOUR_MS),
      completedAt: new Date(Date.now() - HOUR_MS),
    });

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).not.toContain(succeeded.id);
    const row = await prisma.batchExecution.findUniqueOrThrow({ where: { id: succeeded.id } });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.errorCode).toBeNull();
  });

  it("does NOT touch an already-FAILED row (a real application failure), even with an old heartbeat", async () => {
    const failed = await createExecution({
      status: "FAILED",
      heartbeatAt: new Date(Date.now() - HOUR_MS),
      completedAt: new Date(Date.now() - HOUR_MS),
    });
    await prisma.batchExecution.update({ where: { id: failed.id }, data: { errorCode: "ValidationError" } });

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).not.toContain(failed.id);
    const row = await prisma.batchExecution.findUniqueOrThrow({ where: { id: failed.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("ValidationError");
  });

  it("treats a row exactly AT the threshold as not-yet-stale (matches checkBatch()'s own `lt`, not `lte`)", async () => {
    // Deterministic boundary test via the injectable `now` param (mirrors
    // runBatchJob's own `now?: Date`): cutoff = fixedNow - 30min exactly.
    const fixedNow = new Date("2026-06-01T12:00:00.000Z");
    const cutoff = new Date(fixedNow.getTime() - 30 * MINUTE_MS);

    const exactlyAtCutoff = await createExecution({ status: "RUNNING", heartbeatAt: cutoff });
    const oneMsPastCutoff = await createExecution({ status: "RUNNING", heartbeatAt: new Date(cutoff.getTime() - 1) });

    const result = await recoverStaleBatchExecutions(30, fixedNow);

    expect(result.recoveredIds).not.toContain(exactlyAtCutoff.id);
    expect(result.recoveredIds).toContain(oneMsPastCutoff.id);
  });

  it("is idempotent - recovering the same row twice in a row only recovers it once, second call is a no-op for it", async () => {
    const stale = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const first = await recoverStaleBatchExecutions();
    expect(first.recoveredIds).toContain(stale.id);

    const second = await recoverStaleBatchExecutions();
    expect(second.recoveredIds).not.toContain(stale.id);

    const row = await prisma.batchExecution.findUniqueOrThrow({ where: { id: stale.id } });
    expect(row.status).toBe("FAILED");
  });

  it("recovers multiple stale rows across different jobNames in one call", async () => {
    const a = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS), jobName: `${JOB_PREFIX}:multi-a` });
    const b = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS), jobName: `${JOB_PREFIX}:multi-b` });
    const c = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS), jobName: `${JOB_PREFIX}:multi-c` });

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });

  it("concurrent recovery calls never double-count or conflict - the union of both calls' recovered ids has no duplicates and covers every stale row exactly once", async () => {
    const rows = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS), jobName: `${JOB_PREFIX}:concurrent-${i}` })
      )
    );

    const [first, second] = await Promise.all([recoverStaleBatchExecutions(), recoverStaleBatchExecutions()]);

    const combined = [...first.recoveredIds, ...second.recoveredIds];
    const uniqueCombined = new Set(combined);
    // Every row recovered exactly once across both concurrent calls - never twice.
    expect(combined.length).toBe(uniqueCombined.size);
    for (const row of rows) {
      expect(uniqueCombined.has(row.id)).toBe(true);
    }
  });
});

describe("checkReadiness() batch check transitions with recovery", () => {
  it("batch goes from error to ok after recoverStaleBatchExecutions() clears the offending row", async () => {
    const stale = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const before = await checkReadiness();
    expect(before.checks.batch).toBe("error");

    await recoverStaleBatchExecutions();

    const after = await checkReadiness();
    expect(after.checks.batch).toBe("ok");
    void stale;
  });

  it("a recent active RUNNING row keeps batch ok on its own (nothing to recover)", async () => {
    await createExecution({ status: "RUNNING", heartbeatAt: new Date() });

    const result = await checkReadiness();
    expect(result.checks.batch).toBe("ok");
  });

  it("a genuinely stale row that has NOT yet been recovered still correctly reports batch error", async () => {
    await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const result = await checkReadiness();
    expect(result.checks.batch).toBe("error");
  });
});

describe("status-guarded races between recovery and a live worker's own writes", () => {
  it("heartbeat wins first: a fresh heartbeat lands before recovery runs, so recovery re-checks the predicate and leaves the row RUNNING untouched", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    // The live worker's heartbeat lands first, in real time, before the
    // recovery job's own UPDATE...WHERE...RETURNING statement runs.
    const applied = await touchBatchExecutionHeartbeat(row.id, new Date());
    expect(applied).toBe(true);

    const result = await recoverStaleBatchExecutions();

    expect(result.recoveredIds).not.toContain(row.id);
    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("RUNNING");
  });

  it("recovery wins first: a stale row is recovered, then a late heartbeat from the original (zombie) process is a no-op and cannot revive it", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const result = await recoverStaleBatchExecutions();
    expect(result.recoveredIds).toContain(row.id);

    // The original process is still alive and has no idea it was just
    // recovered - it calls ctx.heartbeat() as usual.
    const applied = await touchBatchExecutionHeartbeat(row.id, new Date());
    expect(applied).toBe(false);

    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
  });

  it("success transition racing stale recovery: recovery wins first, so the original process's later markBatchExecutionSucceeded() call is a no-op and cannot flip a recovered row back to SUCCEEDED", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const result = await recoverStaleBatchExecutions();
    expect(result.recoveredIds).toContain(row.id);

    // The original job body actually finishes normally right after being
    // recovered - it has no idea its BatchExecution row was already
    // marked orphaned, and calls its own natural success path.
    const applied = await markBatchExecutionSucceeded(row.id, {
      completedAt: new Date(),
      processedCount: 5,
      successCount: 5,
      failureCount: 0,
    });
    expect(applied).toBe(false);

    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
    expect(after.processedCount).toBe(0);
  });

  it("failure transition racing stale recovery: recovery wins first, so the original process's later markBatchExecutionFailed() call is a no-op and does not overwrite the orphan classification with the real error", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    const result = await recoverStaleBatchExecutions();
    expect(result.recoveredIds).toContain(row.id);

    // The original job body throws its own real error right after being
    // recovered.
    const applied = await markBatchExecutionFailed(row.id, {
      completedAt: new Date(),
      errorCode: "ProviderTimeoutError",
      processedCount: 3,
      successCount: 2,
      failureCount: 1,
    });
    expect(applied).toBe(false);

    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    // The orphan classification is preserved - not overwritten by the
    // real (later-arriving) failure reason.
    expect(after.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
  });

  it("a recovered FAILED row cannot subsequently become SUCCEEDED from the old execution path, even across a simulated concurrent arrival ordering", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date(Date.now() - HOUR_MS) });

    // Both writers race for the same row; only one write can ever apply
    // per statement thanks to the status='RUNNING' guard, regardless of
    // which one Postgres happens to execute first.
    const [recoveryResult, successApplied] = await Promise.all([
      recoverStaleBatchExecutions(),
      markBatchExecutionSucceeded(row.id, {
        completedAt: new Date(),
        processedCount: 1,
        successCount: 1,
        failureCount: 0,
      }),
    ]);

    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });

    if (recoveryResult.recoveredIds.includes(row.id)) {
      // Recovery won the race - the success write must have no-opped and
      // the row must still show the orphan classification.
      expect(successApplied).toBe(false);
      expect(after.status).toBe("FAILED");
      expect(after.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
    } else {
      // The success write won the race - recovery must have no-opped
      // (the row no longer matched status='RUNNING' by the time recovery's
      // UPDATE ran) and the row must show a genuine success, never left
      // half-updated by the loser.
      expect(successApplied).toBe(true);
      expect(after.status).toBe("SUCCEEDED");
    }
    // Either way, the row lands in exactly one well-defined terminal
    // state - never RUNNING forever, never a mixed/corrupted write.
    expect(after.status === "FAILED" || after.status === "SUCCEEDED").toBe(true);
  });
});

// "Late success/failure after recovery cannot overwrite the orphan
// classification" is already covered above by "recovery wins first: ...
// late heartbeat ... cannot revive it", "success transition racing stale
// recovery: ...", and "failure transition racing stale recovery: ..." -
// not duplicated here.
describe("runBatchJob's automatic heartbeat loop vs. recovery", () => {
  it("recovery does not classify a legitimately-running auto-heartbeating job as stale, even under a threshold much tighter than the real 30 minutes", async () => {
    const jobName = `${JOB_PREFIX}:auto-heartbeat-vs-recovery:${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const runPromise = runBatchJob({
      jobName,
      cadence: "instant",
      heartbeatIntervalMs: 25,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { processedCount: 1, successCount: 1, failureCount: 0 };
      },
    });

    // Let several automatic ticks land before checking.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const row = await prisma.batchExecution.findFirstOrThrow({ where: { jobName } });
    createdIds.push(row.id);
    expect(row.status).toBe("RUNNING");

    // A 120ms threshold (equivalent-scale stand-in for the real 30-minute
    // one) must still leave this row alone - its heartbeat is never more
    // than ~25ms stale thanks to the automatic loop, comfortably under it.
    const midFlight = await recoverStaleBatchExecutions(120 / 60_000, new Date());
    expect(midFlight.recoveredIds).not.toContain(row.id);

    const outcome = await runPromise;
    expect(outcome.skipped).toBe(false);
  });

  it("worker/process death simulation: heartbeat stops (loop killed mid-job, exactly like a crashed process), then after the stale threshold recovery transitions the row to FAILED", async () => {
    const row = await createExecution({ status: "RUNNING", heartbeatAt: new Date() });

    const loop = startBatchHeartbeatLoop(row.id, { touch: touchBatchExecutionHeartbeat, intervalMs: 20 });
    // A few real ticks prove the row genuinely WAS alive and heartbeating.
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Simulates the worker process dying: the loop is killed (as a crash
    // would kill it) with no corresponding markBatchExecutionSucceeded/
    // Failed() ever called - the row is abandoned RUNNING, exactly the
    // orphan scenario this whole feature exists to recover from.
    await loop.stop();

    const aliveRow = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(aliveRow.status).toBe("RUNNING");
    expect(aliveRow.heartbeatAt!.getTime()).toBeGreaterThan(row.heartbeatAt!.getTime());

    // The "worker" never comes back - simulate time passing via the
    // injectable `now` param rather than a real 30-minute wait.
    const result = await recoverStaleBatchExecutions(30, new Date(Date.now() + 31 * 60 * 1000));
    expect(result.recoveredIds).toContain(row.id);

    const after = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe("ORPHANED_STALE_HEARTBEAT");
  });
});
