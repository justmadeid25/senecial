import { afterAll, describe, expect, it } from "vitest";

import { runBatchJob } from "@/server/batch/run-batch-job";
import { prisma } from "@/server/db/client";

const JOB_PREFIX = "test:batch-execution";
const jobNames: string[] = [];

afterAll(async () => {
  await prisma.batchExecution.deleteMany({ where: { jobName: { in: jobNames } } });
});

function uniqueJobName(suffix: string): string {
  const name = `${JOB_PREFIX}:${suffix}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  jobNames.push(name);
  return name;
}

describe("runBatchJob (§27/§28/§48)", () => {
  it("records a BatchExecution row with counts on success", async () => {
    const jobName = uniqueJobName("success-counts");
    const outcome = await runBatchJob({
      jobName,
      cadence: "instant",
      run: async () => ({ processedCount: 5, successCount: 4, failureCount: 1 }),
    });

    expect(outcome.skipped).toBe(false);
    if (outcome.skipped) throw new Error("unreachable");

    const row = await prisma.batchExecution.findUnique({ where: { id: outcome.executionId } });
    expect(row?.status).toBe("SUCCEEDED");
    expect(row?.processedCount).toBe(5);
    expect(row?.successCount).toBe(4);
    expect(row?.failureCount).toBe(1);
    expect(row?.completedAt).not.toBeNull();
  });

  it("marks BatchExecution FAILED with a safe errorCode (not the raw message) when the job throws", async () => {
    const jobName = uniqueJobName("failure");

    await expect(
      runBatchJob({
        jobName,
        cadence: "instant",
        run: async () => {
          throw new Error("raw internal detail that must not be persisted");
        },
      })
    ).rejects.toThrow();

    const row = await prisma.batchExecution.findFirst({ where: { jobName } });
    expect(row?.status).toBe("FAILED");
    expect(row?.errorCode).toBe("Error");
    expect(row?.errorCode).not.toContain("raw internal detail");
  });

  it("prevents two concurrent invocations of the same job (advisory lock)", async () => {
    const jobName = uniqueJobName("concurrent");
    const now = new Date();

    const [a, b] = await Promise.all([
      runBatchJob({
        jobName,
        cadence: "instant",
        now,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
      runBatchJob({
        jobName,
        cadence: "instant",
        now,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
    ]);

    const skippedCount = [a, b].filter((r) => r.skipped).length;
    expect(skippedCount).toBe(1);
  });

  it("allows two DIFFERENT jobs to run concurrently (locks are per-job, not global)", async () => {
    const jobNameA = uniqueJobName("different-a");
    const jobNameB = uniqueJobName("different-b");

    const [a, b] = await Promise.all([
      runBatchJob({
        jobName: jobNameA,
        cadence: "instant",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
      runBatchJob({
        jobName: jobNameB,
        cadence: "instant",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
    ]);

    expect(a.skipped).toBe(false);
    expect(b.skipped).toBe(false);
  });

  it("blocks a second run within the same daily window, but not after the lock/window changes", async () => {
    const jobName = uniqueJobName("daily-window");
    const now = new Date("2026-05-15T10:00:00.000Z");

    const first = await runBatchJob({
      jobName,
      cadence: "daily",
      now,
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(first.skipped).toBe(false);

    const secondSameDay = await runBatchJob({
      jobName,
      cadence: "daily",
      now: new Date("2026-05-15T18:00:00.000Z"),
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(secondSameDay.skipped).toBe(true);

    const nextDay = await runBatchJob({
      jobName,
      cadence: "daily",
      now: new Date("2026-05-16T10:00:00.000Z"),
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(nextDay.skipped).toBe(false);
  });

  it("releases the lock after completion, allowing a subsequent instant-cadence run", async () => {
    const jobName = uniqueJobName("lock-release");

    const first = await runBatchJob({
      jobName,
      cadence: "instant",
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(first.skipped).toBe(false);

    const second = await runBatchJob({
      jobName,
      cadence: "instant",
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(second.skipped).toBe(false);
  });

  it("force:true bypasses the same-day window dedup for a deliberate manual re-run", async () => {
    const jobName = uniqueJobName("force-bypass");
    const now = new Date("2026-06-01T09:00:00.000Z");

    const first = await runBatchJob({
      jobName,
      cadence: "daily",
      now,
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(first.skipped).toBe(false);

    // Without force, a second same-day run is skipped (regression test for
    // the same bug this fixes: notifications:generate blocking a
    // legitimate on-demand re-run within the same day).
    const secondWithoutForce = await runBatchJob({
      jobName,
      cadence: "daily",
      now: new Date("2026-06-01T15:00:00.000Z"),
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(secondWithoutForce.skipped).toBe(true);

    const secondWithForce = await runBatchJob({
      jobName,
      cadence: "daily",
      now: new Date("2026-06-01T16:00:00.000Z"),
      force: true,
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(secondWithForce.skipped).toBe(false);

    const executions = await prisma.batchExecution.findMany({ where: { jobName } });
    expect(executions).toHaveLength(2);
    expect(executions.every((e) => e.status === "SUCCEEDED")).toBe(true);
  });

  it("force:true still respects the advisory lock - cannot bypass true concurrency", async () => {
    const jobName = uniqueJobName("force-still-locks");
    const now = new Date();

    const [a, b] = await Promise.all([
      runBatchJob({
        jobName,
        cadence: "daily",
        now,
        force: true,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
      runBatchJob({
        jobName,
        cadence: "daily",
        now,
        force: true,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { processedCount: 1, successCount: 1, failureCount: 0 };
        },
      }),
    ]);

    const skippedCount = [a, b].filter((r) => r.skipped).length;
    expect(skippedCount).toBe(1);
  });

  it("automatically refreshes heartbeatAt while a real job body is still running, with no job author calling ctx.heartbeat()", async () => {
    const jobName = uniqueJobName("auto-heartbeat");
    let heartbeatAtMidFlight: Date | null = null;

    const outcome = await runBatchJob({
      jobName,
      cadence: "instant",
      heartbeatIntervalMs: 30,
      run: async () => {
        // Long enough, at a 30ms interval, to guarantee at least one
        // automatic tick has landed before we read the row back.
        await new Promise((resolve) => setTimeout(resolve, 120));
        const row = await prisma.batchExecution.findFirst({ where: { jobName } });
        heartbeatAtMidFlight = row?.heartbeatAt ?? null;
        return { processedCount: 1, successCount: 1, failureCount: 0 };
      },
    });

    expect(outcome.skipped).toBe(false);
    if (outcome.skipped) throw new Error("unreachable");

    const startedRow = await prisma.batchExecution.findUniqueOrThrow({ where: { id: outcome.executionId } });
    expect(heartbeatAtMidFlight).not.toBeNull();
    // The automatic loop refreshed heartbeatAt strictly past its own
    // startedAt - proof the write-once behavior from before this
    // changeset is gone, with no ctx.heartbeat() call anywhere in this
    // job body.
    expect(heartbeatAtMidFlight!.getTime()).toBeGreaterThan(startedRow.startedAt.getTime());
    expect(startedRow.status).toBe("SUCCEEDED");
  });

  it("stops the automatic heartbeat loop immediately once the job succeeds - no further ticks after completion", async () => {
    const jobName = uniqueJobName("auto-heartbeat-stops-on-success");

    const outcome = await runBatchJob({
      jobName,
      cadence: "instant",
      heartbeatIntervalMs: 20,
      run: async () => ({ processedCount: 1, successCount: 1, failureCount: 0 }),
    });
    expect(outcome.skipped).toBe(false);
    if (outcome.skipped) throw new Error("unreachable");

    const afterCompletion = await prisma.batchExecution.findUniqueOrThrow({ where: { id: outcome.executionId } });
    // Give any (incorrectly still-running) loop several interval-lengths
    // to prove it does NOT tick again after the row already went terminal.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const later = await prisma.batchExecution.findUniqueOrThrow({ where: { id: outcome.executionId } });

    expect(later.status).toBe("SUCCEEDED");
    expect(later.heartbeatAt!.getTime()).toBe(afterCompletion.heartbeatAt!.getTime());
  });

  it("stops the automatic heartbeat loop immediately once the job throws - no further ticks after the FAILED transition", async () => {
    const jobName = uniqueJobName("auto-heartbeat-stops-on-failure");

    await expect(
      runBatchJob({
        jobName,
        cadence: "instant",
        heartbeatIntervalMs: 20,
        run: async () => {
          throw new Error("boom");
        },
      })
    ).rejects.toThrow();

    const row = await prisma.batchExecution.findFirstOrThrow({ where: { jobName } });
    expect(row.status).toBe("FAILED");
    const heartbeatAfterFailure = row.heartbeatAt!.getTime();

    await new Promise((resolve) => setTimeout(resolve, 150));
    const later = await prisma.batchExecution.findUniqueOrThrow({ where: { id: row.id } });
    expect(later.heartbeatAt!.getTime()).toBe(heartbeatAfterFailure);
  });

  it("manual ctx.heartbeat() still works alongside the automatic loop, for a job author that wants an explicit immediate refresh", async () => {
    const jobName = uniqueJobName("manual-ctx-heartbeat");

    const outcome = await runBatchJob({
      jobName,
      cadence: "instant",
      heartbeatIntervalMs: 5000, // automatic loop won't tick within this test's short lifetime
      run: async (ctx) => {
        const before = await prisma.batchExecution.findFirstOrThrow({ where: { jobName } });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await ctx.heartbeat();
        const after = await prisma.batchExecution.findFirstOrThrow({ where: { jobName } });
        expect(after.heartbeatAt!.getTime()).toBeGreaterThan(before.heartbeatAt!.getTime());
        return { processedCount: 1, successCount: 1, failureCount: 0 };
      },
    });

    expect(outcome.skipped).toBe(false);
  });
});
