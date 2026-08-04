/**
 * §Phase 12.2 Part E (§29 Latency budget) - development targets, each
 * calibrated for a REAL provider (a network round-trip to an external
 * embedding/LLM API), not the synchronous in-process "development"
 * provider used by default in dev/test/CI. Mixing the two would make every
 * budget meaningless (the dev provider is near-instant by construction) -
 * per §29's own instruction ("현재 development provider와 실제 provider
 * 지표를 섞지 마십시오"), `exceedsLatencyBudget()` is a deliberate no-op
 * whenever `isDevelopmentProvider` is true; the raw latency is still
 * recorded via recordDependencyLatency() regardless; only the BUDGET
 * comparison (and its violation counter) is skipped for the dev provider.
 *
 * `vectorSearch`/`keywordSearch`/`hybridMerge` are always real Postgres
 * operations regardless of which embedding/LLM provider is configured, so
 * their budgets are never gated by `isDevelopmentProvider` - callers pass
 * `false` for those.
 */
export const LATENCY_BUDGET_MS = {
  embedding: 2000,
  vectorSearch: 100,
  keywordSearch: 100,
  hybridMerge: 50,
  retrieval: 500,
  llm: 3000,
} as const;

export type LatencyBudgetOperation = keyof typeof LATENCY_BUDGET_MS;

/**
 * Returns true if this single sample exceeded its named budget.
 * `isDevelopmentProvider` must be true only when the AI provider that
 * actually served this specific call (embedding or LLM) is the
 * deterministic "development" driver - pass `false` for DB-native
 * operations (vectorSearch/keywordSearch/hybridMerge/retrieval), which are
 * never provider-gated.
 */
export function exceedsLatencyBudget(operation: LatencyBudgetOperation, durationMs: number, isDevelopmentProvider: boolean): boolean {
  if (isDevelopmentProvider) {
    return false;
  }
  return durationMs > LATENCY_BUDGET_MS[operation];
}
