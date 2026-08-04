import { execSync } from "node:child_process";

/**
 * §Phase 12.4 §13 - `pnpm release:verify`. A single command that runs
 * every gate a release must pass, IN ORDER, stopping (non-zero exit) at
 * the first failure - never continuing past a broken step to produce a
 * misleadingly complete-looking report. This is the one command CI's
 * release-blocking job runs (see .github/workflows/ci.yml's
 * `release-verify` job) - a human running it locally sees exactly what
 * CI will see.
 *
 * Order matters: cheap/fast checks first (secret scan, migration
 * verifier, prisma validate, typecheck, lint) so an obvious mistake fails
 * in seconds, not after a 10+ minute E2E run. `pnpm test:e2e:prod`
 * (step 9) already runs its own preflight (§1) and post-run cleanup
 * verification (§8) internally - this script does not duplicate that
 * logic, it just fails loudly if that step's exit code is non-zero.
 */

interface Step {
  name: string;
  command: string;
}

const STEPS: Step[] = [
  { name: "1. Secret scan", command: "pnpm exec tsx scripts/secret-scan.ts" },
  { name: "2. Migration verifier", command: "pnpm db:verify-migrations" },
  { name: "3. Prisma validate", command: "pnpm exec prisma validate" },
  { name: "4. TypeScript", command: "pnpm exec tsc --noEmit" },
  { name: "5. ESLint", command: "pnpm exec eslint ." },
  { name: "6. Unit/integration tests", command: "pnpm test" },
  { name: "7. Build", command: "pnpm build" },
  { name: "8. AI evaluation release gate", command: "pnpm ai:evaluate --compare --gate" },
  { name: "9. Production-like E2E (includes preflight + cleanup verification)", command: "pnpm test:e2e:prod" },
];

async function main(): Promise<void> {
  const skip = new Set((process.env.RELEASE_VERIFY_SKIP_STEPS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const startedAt = Date.now();
  const results: Array<{ name: string; ok: boolean; durationMs: number }> = [];

  for (const step of STEPS) {
    if (skip.has(step.name)) {
      console.log(`\n[release:verify] SKIP (RELEASE_VERIFY_SKIP_STEPS): ${step.name}`);
      continue;
    }
    console.log(`\n[release:verify] === ${step.name} ===`);
    const stepStart = Date.now();
    try {
      execSync(step.command, { stdio: "inherit" });
      const durationMs = Date.now() - stepStart;
      results.push({ name: step.name, ok: true, durationMs });
      console.log(`[release:verify] OK (${(durationMs / 1000).toFixed(1)}s): ${step.name}`);
    } catch (error) {
      const durationMs = Date.now() - stepStart;
      results.push({ name: step.name, ok: false, durationMs });
      console.error(`[release:verify] FAIL (${(durationMs / 1000).toFixed(1)}s): ${step.name}`);
      console.error(`[release:verify] 실패 - 이후 단계를 실행하지 않고 즉시 종료합니다.`);
      printSummary(results, Date.now() - startedAt);
      process.exitCode = (error as { status?: number }).status ?? 1;
      return;
    }
  }

  printSummary(results, Date.now() - startedAt);
  console.log("\n[release:verify] 모든 단계 통과 - 릴리스 준비 완료.");
}

function printSummary(results: Array<{ name: string; ok: boolean; durationMs: number }>, totalMs: number): void {
  console.log("\n[release:verify] === 요약 ===");
  for (const r of results) {
    console.log(`  [${r.ok ? "OK  " : "FAIL"}] ${r.name} - ${(r.durationMs / 1000).toFixed(1)}s`);
  }
  console.log(`  총 소요시간: ${(totalMs / 1000).toFixed(1)}s`);
}

main().catch((error: unknown) => {
  console.error("[release:verify] 치명적 오류:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
