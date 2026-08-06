/**
 * §Phase 13 Part G (§27) - a generic, amount-based reservation counter
 * (not a boolean semaphore like ConcurrencyLimiter): "reserve N against a
 * cap, roll back atomically if it would exceed the cap." The SAME
 * primitive backs both cost reservation (N = estimated micro-cents) and
 * request-count reservation (N = 1) - see reserve-ai-budget.ts, which
 * composes several of these (monthly cost, monthly count, daily count)
 * into one all-or-nothing budget check.
 */
export interface BudgetCounterReserveResult {
  reserved: boolean;
  currentValue: number;
}

export interface BudgetCounter {
  /** Atomically adds `amount` to the counter (creating it with `ttlSeconds` if new); rolls back and returns reserved:false if the result would exceed `limit`. Never blocks. */
  reserve(key: string, amount: number, limit: number, ttlSeconds: number): Promise<BudgetCounterReserveResult>;
  /** Adjusts a previously reserved amount by `deltaAmount` (positive or negative) once the REAL amount is known - e.g. settling an estimated cost reservation against the provider's actual reported usage. */
  adjust(key: string, deltaAmount: number): Promise<void>;
  /** Fully releases a reservation (subtracts the full amount) - used when the AI operation failed entirely and no real cost was incurred. */
  release(key: string, amount: number): Promise<void>;
}
