import { describe, expect, it, vi } from "vitest";

/** Module-scoped in-flight map (Phase 12.2 §35) - fresh module per test avoids leakage between tests, same pattern as metrics.test.ts. */
async function load() {
  vi.resetModules();
  return import("@/server/services/ai/cache/in-flight-deduplication");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withInFlightDeduplication (Phase 12.2 §35 stampede)", () => {
  it("joins a concurrent call for the same key into a single factory invocation", async () => {
    const { withInFlightDeduplication } = await load();
    const gate = deferred<string>();
    let callCount = 0;
    const factory = () => {
      callCount += 1;
      return gate.promise;
    };

    const first = withInFlightDeduplication("key-a", factory);
    const second = withInFlightDeduplication("key-a", factory);

    gate.resolve("computed-value");
    const [a, b] = await Promise.all([first, second]);

    expect(callCount).toBe(1);
    expect(a).toBe("computed-value");
    expect(b).toBe("computed-value");
  });

  it("does not join calls for different keys", async () => {
    const { withInFlightDeduplication } = await load();
    let callCount = 0;
    const factory = async () => {
      callCount += 1;
      return "value";
    };

    await Promise.all([withInFlightDeduplication("key-a", factory), withInFlightDeduplication("key-b", factory)]);

    expect(callCount).toBe(2);
  });

  it("allows a new computation for the same key once the previous one has settled", async () => {
    const { withInFlightDeduplication } = await load();
    let callCount = 0;
    const factory = async () => {
      callCount += 1;
      return `call-${callCount}`;
    };

    const first = await withInFlightDeduplication("key-a", factory);
    const second = await withInFlightDeduplication("key-a", factory);

    expect(first).toBe("call-1");
    expect(second).toBe("call-2");
    expect(callCount).toBe(2);
  });

  it("propagates a rejection to every joiner, and clears the in-flight entry so a retry can succeed", async () => {
    const { withInFlightDeduplication } = await load();
    let attempt = 0;
    const factory = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("boom");
      }
      return "recovered";
    };

    const firstCall = withInFlightDeduplication("key-a", factory);
    const joiner = withInFlightDeduplication("key-a", factory);

    await expect(firstCall).rejects.toThrow("boom");
    await expect(joiner).rejects.toThrow("boom");

    const retried = await withInFlightDeduplication("key-a", factory);
    expect(retried).toBe("recovered");
  });
});
