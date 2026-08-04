import { describe, expect, it } from "vitest";

import { hasContractChangedSinceExtraction } from "@/domain/extraction/optimistic-concurrency";

describe("hasContractChangedSinceExtraction", () => {
  it("returns false when the contract's updatedAt matches the snapshot exactly", () => {
    const timestamp = new Date("2026-07-29T00:00:00.000Z");
    expect(hasContractChangedSinceExtraction(timestamp, new Date(timestamp))).toBe(false);
  });

  it("returns true when the contract's updatedAt differs from the snapshot", () => {
    const snapshot = new Date("2026-07-29T00:00:00.000Z");
    const changed = new Date("2026-07-29T00:05:00.000Z");
    expect(hasContractChangedSinceExtraction(changed, snapshot)).toBe(true);
  });

  it("returns false when there is no snapshot to compare against", () => {
    expect(hasContractChangedSinceExtraction(new Date(), null)).toBe(false);
  });

  it("is sensitive to millisecond-level differences", () => {
    const snapshot = new Date("2026-07-29T00:00:00.000Z");
    const changed = new Date(snapshot.getTime() + 1);
    expect(hasContractChangedSinceExtraction(changed, snapshot)).toBe(true);
  });
});
