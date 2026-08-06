import type { BudgetCounter, BudgetCounterReserveResult } from "@/domain/ai/budget-counter";

interface CounterEntry {
  value: number;
  expiresAt: number;
}

/** Process-local only (see get-ai-budget-counter.ts's production guard, same pattern as InMemoryConcurrencyLimiter). */
export class InMemoryBudgetCounter implements BudgetCounter {
  private readonly counters = new Map<string, CounterEntry>();

  private getValue(key: string): number {
    const entry = this.counters.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      return 0;
    }
    return entry.value;
  }

  private setValue(key: string, value: number, ttlSeconds: number): void {
    const existing = this.counters.get(key);
    const expiresAt = existing && existing.expiresAt >= Date.now() ? existing.expiresAt : Date.now() + ttlSeconds * 1000;
    this.counters.set(key, { value, expiresAt });
  }

  async reserve(key: string, amount: number, limit: number, ttlSeconds: number): Promise<BudgetCounterReserveResult> {
    const current = this.getValue(key) + amount;
    if (current > limit) {
      this.setValue(key, current - amount, ttlSeconds);
      return { reserved: false, currentValue: current - amount };
    }
    this.setValue(key, current, ttlSeconds);
    return { reserved: true, currentValue: current };
  }

  async adjust(key: string, deltaAmount: number): Promise<void> {
    const next = Math.max(0, this.getValue(key) + deltaAmount);
    this.setValue(key, next, 60 * 60 * 24 * 40);
  }

  async release(key: string, amount: number): Promise<void> {
    const next = Math.max(0, this.getValue(key) - amount);
    this.setValue(key, next, 60 * 60 * 24 * 40);
  }
}
