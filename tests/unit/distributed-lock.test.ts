import { describe, expect, it } from "vitest";

import type { DistributedLock } from "@/server/services/ai/cache/distributed-lock";
import { withDistributedLockOrCompute } from "@/server/services/ai/cache/distributed-lock";

/** In-memory fake - real Redis behavior is exercised by the integration suite; this test targets the pure orchestration logic in withDistributedLockOrCompute() itself. */
function fakeLock(initiallyHeld: boolean): DistributedLock {
  let held = initiallyHeld;
  return {
    async tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    async release() {
      held = false;
    },
  };
}

describe("withDistributedLockOrCompute (Phase 12.2 §35 stampede)", () => {
  it("computes and releases when the lock is free", async () => {
    const lock = fakeLock(false);
    let computeCalls = 0;
    const result = await withDistributedLockOrCompute(
      lock,
      "key-a",
      30,
      async () => undefined,
      async () => {
        computeCalls += 1;
        return "computed";
      }
    );
    expect(result).toBe("computed");
    expect(computeCalls).toBe(1);

    // Lock was released - a second call can acquire and compute again.
    const second = await withDistributedLockOrCompute(lock, "key-a", 30, async () => undefined, async () => "second");
    expect(second).toBe("second");
  });

  it("re-checks for a result after acquiring, in case another holder just finished (avoids a redundant compute)", async () => {
    const lock = fakeLock(false);
    let computeCalls = 0;
    const result = await withDistributedLockOrCompute(
      lock,
      "key-a",
      30,
      async () => "already-computed-by-someone-else",
      async () => {
        computeCalls += 1;
        return "should-not-run";
      }
    );
    expect(result).toBe("already-computed-by-someone-else");
    expect(computeCalls).toBe(0);
  });

  it("polls for the result when the lock is already held, and returns it once available - never computing independently", async () => {
    const lock = fakeLock(true); // already held by "another instance"
    let pollCount = 0;
    let computeCalls = 0;

    const result = await withDistributedLockOrCompute(
      lock,
      "key-a",
      30,
      async () => {
        pollCount += 1;
        return pollCount >= 2 ? "published-by-holder" : undefined;
      },
      async () => {
        computeCalls += 1;
        return "should-not-run";
      }
    );

    expect(result).toBe("published-by-holder");
    expect(computeCalls).toBe(0);
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it("§35 - never waits forever: computes independently if the lock holder never publishes a result within the bound", async () => {
    const lock = fakeLock(true); // held forever - simulates a dead/slow holder
    let computeCalls = 0;

    const result = await withDistributedLockOrCompute(
      lock,
      "key-a",
      30,
      async () => undefined, // never has a result
      async () => {
        computeCalls += 1;
        return "computed-independently";
      }
    );

    expect(result).toBe("computed-independently");
    expect(computeCalls).toBe(1);
  }, 10_000);
});
