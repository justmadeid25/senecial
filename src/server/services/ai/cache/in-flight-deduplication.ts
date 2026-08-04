import { recordCacheStampedeJoined } from "@/server/monitoring/metrics";

/**
 * §Phase 12.2 Part F (§35 Cache stampede) - process-scoped, reset
 * naturally as each entry's promise settles (deleted in `.finally()`
 * below) - never grows unbounded.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * §35 - in-process single-flight: if a computation for this exact key is
 * already running in THIS process, every other caller joins the SAME
 * promise instead of starting a duplicate (embedding call / DB retrieval /
 * LLM call). Always active, no config flag - this has no failure mode of
 * its own (a promise either resolves or rejects identically for every
 * joiner) unlike a distributed lock, which can time out or need release
 * handling - see distributed-lock.ts for the cross-instance layer this
 * complements, not replaces.
 */
export async function withInFlightDeduplication<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    recordCacheStampedeJoined();
    return existing;
  }
  const promise = factory().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
