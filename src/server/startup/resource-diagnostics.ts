import { monitorEventLoopDelay } from "node:perf_hooks";
import v8 from "node:v8";

/**
 * §Phase 12.3 Part B (§8 Node resource diagnostics) - started at MODULE
 * LOAD time (not first call) so it has already accumulated a few samples
 * of real event-loop activity by the time `collectResourceDiagnostics()`
 * is first invoked from startup logging - an event-loop-delay histogram
 * created and read in the same instant would report meaningless zeros.
 */
const eventLoopDelayHistogram = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelayHistogram.enable();

export interface ResourceDiagnostics {
  [key: string]: string | number;
  nodeVersion: string;
  pid: number;
  heapSizeLimitMb: number;
  rssMb: number;
  heapUsedMb: number;
  eventLoopDelayMeanMs: number;
  activeResourcesCount: number;
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

/**
 * §8 - "안전하게 기록": every field here is a process-level resource
 * number, never a request/user/org identifier, file path, or query -
 * safe to log unconditionally at any point in the process lifecycle,
 * including right before a crash (see scripts/run-e2e-prod.ts, which
 * captures the last N structured log lines on a server crash for exactly
 * this reason).
 */
export function collectResourceDiagnostics(): ResourceDiagnostics {
  const memory = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();

  return {
    nodeVersion: process.version,
    pid: process.pid,
    heapSizeLimitMb: bytesToMb(heapStats.heap_size_limit),
    rssMb: bytesToMb(memory.rss),
    heapUsedMb: bytesToMb(memory.heapUsed),
    // NaN before any sample is recorded (the histogram was just enabled) -
    // normalized to 0 so JSON.stringify/logging never emits a NaN literal.
    eventLoopDelayMeanMs: Number.isFinite(eventLoopDelayHistogram.mean)
      ? Math.round((eventLoopDelayHistogram.mean / 1e6) * 100) / 100
      : 0,
    // Node 22+ public API (not the undocumented process._getActiveHandles())
    // - sockets, timers, file handles, etc. currently open.
    activeResourcesCount: process.getActiveResourcesInfo().length,
  };
}
