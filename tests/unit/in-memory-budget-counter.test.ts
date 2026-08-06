import { describe, expect, it } from "vitest";

import { InMemoryBudgetCounter } from "@/server/services/ai/budget/in-memory-budget-counter";

describe("InMemoryBudgetCounter (Phase 13 §27 - reserve/adjust/release)", () => {
  it("reserves up to the limit, then rejects and rolls back", async () => {
    const counter = new InMemoryBudgetCounter();
    const first = await counter.reserve("org-1", 60, 100, 3600);
    expect(first.reserved).toBe(true);
    expect(first.currentValue).toBe(60);

    const second = await counter.reserve("org-1", 50, 100, 3600);
    expect(second.reserved).toBe(false);
    // Rolled back - the failed reservation must not leave a partial charge behind.
    expect(second.currentValue).toBe(60);
  });

  it("adjust corrects a reservation down to the real amount", async () => {
    const counter = new InMemoryBudgetCounter();
    await counter.reserve("org-1", 100, 1000, 3600);
    await counter.adjust("org-1", -40); // real cost was only 60, reserved 100
    const after = await counter.reserve("org-1", 0, 1000, 3600);
    expect(after.currentValue).toBe(60);
  });

  it("adjust never goes negative even if the delta over-corrects", async () => {
    const counter = new InMemoryBudgetCounter();
    await counter.reserve("org-1", 10, 1000, 3600);
    await counter.adjust("org-1", -1000);
    const after = await counter.reserve("org-1", 0, 1000, 3600);
    expect(after.currentValue).toBe(0);
  });

  it("release fully frees a reservation", async () => {
    const counter = new InMemoryBudgetCounter();
    await counter.reserve("org-1", 100, 100, 3600);
    const blocked = await counter.reserve("org-1", 1, 100, 3600);
    expect(blocked.reserved).toBe(false);

    await counter.release("org-1", 100);
    const afterRelease = await counter.reserve("org-1", 1, 100, 3600);
    expect(afterRelease.reserved).toBe(true);
  });

  it("tracks different keys independently", async () => {
    const counter = new InMemoryBudgetCounter();
    await counter.reserve("org-1", 100, 100, 3600);
    const orgTwo = await counter.reserve("org-2", 100, 100, 3600);
    expect(orgTwo.reserved).toBe(true);
  });
});
