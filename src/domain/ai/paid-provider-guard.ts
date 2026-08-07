/**
 * §Phase 13.2 - credential presence is a configuration capability, never
 * execution approval. An OPENAI_API_KEY (or any other real provider's
 * key) being present in the environment must never, by itself, cause a
 * real network call from an evaluation, diagnostic, or test context - see
 * docs/operations/ai-platform.md's "Paid provider call safety" section
 * for the incident this module exists to structurally prevent (a free
 * `pnpm ai:evaluate` run silently made a real, unintended OpenAI call
 * because the script had no safety rail of its own beyond whatever
 * AI_LLM_PROVIDER happened to resolve to).
 */
export class PaidProviderCallBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidProviderCallBlockedError";
  }
}

/**
 * Last line of defense - called by executeWithResilience() as the very
 * first statement, before the circuit breaker or retry loop even engage,
 * for EVERY real (paid) provider network attempt regardless of caller
 * (app runtime, a CLI script, or a test). A block here must never be
 * treated as a provider failure (never counted against the circuit
 * breaker, never retried) - it is a local policy decision, not something
 * the provider returned.
 *
 * Production traffic (NODE_ENV=production) is always allowed through -
 * blocking it would break the product itself; this guard exists to
 * protect development/test/CI contexts, not to gate real user-facing
 * requests.
 *
 * NODE_ENV=test is vitest's own default (confirmed empirically - every
 * `pnpm test`/`vitest run` invocation sets it automatically, with no
 * per-test-file opt-in required), so this blocks every unit/integration
 * test unconditionally unless a test explicitly opts in via
 * TEST_REAL_AI_PROVIDER=true - reserved for the real-provider integration
 * suite (tests/integration/openai-provider-real.test.ts and siblings),
 * which sets it itself once its own TEST_OPENAI_API_KEY gate passes (see
 * that file's own docstring) - never something a human sets globally.
 */
export function assertPaidProviderCallAllowed(params: { providerName: string; operation: "embedding" | "llm" }): void {
  if (process.env.NODE_ENV === "test" && process.env.TEST_REAL_AI_PROVIDER !== "true") {
    throw new PaidProviderCallBlockedError(
      `NODE_ENV=test에서 실제 ${params.providerName} provider(${params.operation}) 호출이 차단되었습니다 - ` +
        "의도된 real-provider opt-in 통합 테스트라면 해당 테스트 파일이 TEST_REAL_AI_PROVIDER=true를 스스로 설정해야 합니다."
    );
  }
}

/**
 * CLI-script-level approval check for the paid-provider CLIs
 * (ai-evaluate-provider.ts, ai-provider-diagnose.ts,
 * embedding-backfill.ts) - `--execute` and `ALLOW_PAID_AI_CALLS=true` are
 * EQUIVALENT approval signals (the latter exists for a non-interactive/CI
 * job that sets an env var rather than editing the invoked command line).
 * A script should treat this exactly like its own `--execute` flag for
 * flow-control purposes (dry-run vs. real run).
 */
export function isPaidProviderCliApproved(execute: boolean): boolean {
  return execute || process.env.ALLOW_PAID_AI_CALLS === "true";
}

/**
 * By convention, call this TWICE from a paid-provider CLI script: once at
 * the top of main() right after parsing flags (fail fast, before printing
 * a cost estimate that would otherwise dangle), and again immediately
 * before the actual paid operation triggers - the second call is the real
 * "last line of defense" inside the script, guarding against a future
 * refactor that accidentally reorders code past the top-of-main check.
 * This is DELIBERATELY separate from assertPaidProviderCallAllowed()
 * above - --execute/ALLOW_PAID_AI_CALLS is an operator's explicit intent
 * signal for an on-demand CLI run, never a substitute for the
 * NODE_ENV=test hard guard, and never checked for normal app runtime
 * traffic (which has no "operation" to approve - it just serves
 * configured real requests).
 */
export function assertPaidProviderCliApproved(params: { operation: string; execute: boolean }): void {
  if (!isPaidProviderCliApproved(params.execute)) {
    throw new PaidProviderCallBlockedError(
      `실제 유료 AI provider 호출(${params.operation})이 승인되지 않았습니다 - ` +
        "--execute 플래그 또는 ALLOW_PAID_AI_CALLS=true 환경변수가 필요합니다."
    );
  }
}

/**
 * Used by scripts/ai-evaluate.ts (and nothing else) - unconditionally
 * pins both provider drivers to "development", overriding whatever
 * AI_LLM_PROVIDER/AI_EMBEDDING_PROVIDER already resolved to from .env.
 * Extracted as its own function purely so this behavior is directly
 * unit-testable without spawning the script as a subprocess.
 */
export function forceDevelopmentAiProviders(): void {
  process.env.AI_LLM_PROVIDER = "development";
  process.env.AI_EMBEDDING_PROVIDER = "development";
}
