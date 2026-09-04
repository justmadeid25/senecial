import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startBatchHeartbeatLoop } from "@/server/batch/batch-heartbeat-loop";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Resolves only when explicitly released - used to prove no-overlap by holding a tick "in flight" across a fake-timer advance. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("startBatchHeartbeatLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("A: automatically refreshes the heartbeat while the loop is running", async () => {
    const touch = vi.fn().mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    expect(touch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith("exec-1", expect.any(Date));

    await loop.stop();
  });

  it("B: multiple heartbeat intervals occur for a long-running job", async () => {
    const touch = vi.fn().mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(3);

    await loop.stop();
  });

  it("C: heartbeat stops after stop() is called (simulating the job body succeeding)", async () => {
    const touch = vi.fn().mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("D: heartbeat stops after stop() is called (simulating the job body throwing)", async () => {
    const touch = vi.fn().mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    // The caller's own try/finally calls stop() unconditionally on both
    // the success and throw paths - from the loop's own perspective these
    // are identical, both exercised via the same stop() call.
    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("E: no further heartbeat occurs once the row has left RUNNING (touch returns false) - the loop self-terminates without an explicit stop()", async () => {
    const touch = vi.fn().mockResolvedValue(false);
    const logger = makeLogger();
    startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000, logger });

    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    // No further calls - the loop saw applied=false and stopped itself.
    expect(touch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "batch.heartbeat_stopped_not_running",
      expect.objectContaining({ executionId: "exec-1" })
    );
  });

  it("F: heartbeat callbacks never overlap - a slow write delays the next tick rather than running concurrently", async () => {
    const slow = deferred<boolean>();
    const touch = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    // First tick fires and starts its (still-pending) write.
    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);

    // Two more interval-lengths pass while the first write is still in
    // flight - a naive setInterval would have fired 2 more overlapping
    // calls by now; this loop must not have scheduled a second tick yet,
    // since scheduling only happens after the in-flight write settles.
    await vi.advanceTimersByTimeAsync(2000);
    expect(touch).toHaveBeenCalledTimes(1);

    // Now let the first write resolve - only then should the next tick
    // get scheduled (one interval later).
    slow.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("G: a heartbeat write failure is logged but does not stop the loop or throw", async () => {
    const touch = vi.fn().mockRejectedValueOnce(new Error("connection reset")).mockResolvedValue(true);
    const logger = makeLogger();
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000, logger, jobName: "test:job" });

    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "batch.heartbeat_write_failed",
      expect.objectContaining({ executionId: "exec-1", jobName: "test:job", error: "connection reset" })
    );

    // The loop keeps going on the next tick despite the failure.
    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("stop() awaits an in-flight write before resolving, so no write can start after stop() has resolved", async () => {
    const slow = deferred<boolean>();
    const touch = vi.fn().mockReturnValue(slow.promise);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(touch).toHaveBeenCalledTimes(1);

    let stopResolved = false;
    const stopPromise = loop.stop().then(() => {
      stopResolved = true;
    });

    // stop() must not resolve while the in-flight write is still pending.
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    slow.resolve(true);
    await stopPromise;
    expect(stopResolved).toBe(true);

    // No further ticks after stop(), even if time is advanced.
    await vi.advanceTimersByTimeAsync(10000);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("stop() is a safe no-op when called before any tick has fired", async () => {
    const touch = vi.fn().mockResolvedValue(true);
    const loop = startBatchHeartbeatLoop("exec-1", { touch, intervalMs: 1000 });

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(touch).not.toHaveBeenCalled();
  });
});
