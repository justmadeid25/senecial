import type { BudgetCounter, BudgetCounterReserveResult } from "@/domain/ai/budget-counter";

import type { RedisWithBudgetCommands } from "./redis-budget-client";

/** Real (not a stub) Redis-backed reservation counter - see redis-budget-lua-scripts.ts for the atomic reserve/adjust/release logic. */
export class RedisBudgetCounter implements BudgetCounter {
  constructor(private readonly client: RedisWithBudgetCommands) {}

  async reserve(key: string, amount: number, limit: number, ttlSeconds: number): Promise<BudgetCounterReserveResult> {
    const [reserved, currentValue] = await this.client.budgetReserve(key, amount, limit, ttlSeconds);
    return { reserved: reserved === 1, currentValue };
  }

  async adjust(key: string, deltaAmount: number): Promise<void> {
    await this.client.budgetAdjust(key, deltaAmount);
  }

  async release(key: string, amount: number): Promise<void> {
    await this.client.budgetRelease(key, amount);
  }
}
