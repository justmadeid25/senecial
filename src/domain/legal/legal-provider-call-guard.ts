/**
 * §Phase L1 §12 - mirrors domain/ai/paid-provider-guard.ts's structural
 * safety rail, adapted for the Law Open Data provider: an OC credential
 * being present in the environment must never, by itself, cause a real
 * network call from a test/CI context. The Law Open Data API is free (no
 * billing risk), but a real call is still an external, non-deterministic
 * network dependency this codebase's test suite must never depend on (see
 * AGENTS.md §11 - "Tests must NOT depend on live external API
 * availability").
 *
 * Deliberately a SEPARATE guard from assertPaidProviderCallAllowed() - this
 * phase must not modify or refactor the existing AI provider guard/call
 * sites (AGENTS.md's "do not refactor unrelated AI code").
 */
export class LegalProviderCallBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalProviderCallBlockedError";
  }
}

/**
 * Last line of defense - called as the very first statement of every real
 * Law Open Data network attempt, before any circuit breaker/retry loop
 * engages. NODE_ENV=test blocks every unit/integration test unconditionally
 * unless a test explicitly opts in via TEST_REAL_LEGAL_PROVIDER=true -
 * reserved for a future real-provider integration suite, never something a
 * human sets globally. Production traffic is always allowed through.
 */
export function assertLegalProviderCallAllowed(params: { providerName: string; operation: "search" | "fetch" }): void {
  if (process.env.NODE_ENV === "test" && process.env.TEST_REAL_LEGAL_PROVIDER !== "true") {
    throw new LegalProviderCallBlockedError(
      `NODE_ENV=test에서 실제 ${params.providerName} provider(${params.operation}) 호출이 차단되었습니다 - ` +
        "의도된 real-provider opt-in 통합 테스트라면 해당 테스트 파일이 TEST_REAL_LEGAL_PROVIDER=true를 스스로 설정해야 합니다."
    );
  }
}
