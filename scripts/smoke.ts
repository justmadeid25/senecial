import "dotenv/config";

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePackageBinEntry } from "../src/server/process/resolve-package-bin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

/**
 * Phase 11 Part D - `pnpm smoke`: the single command a deploy pipeline
 * runs after a fresh deployment is up. Two stages, both against the same
 * target (`SMOKE_BASE_URL`, default `http://localhost:3000`):
 *
 *  1. Infra smoke (scripts/smoke-test.ts) - live/ready probe, no data
 *     written.
 *  2. Golden-path smoke (tests/e2e/smoke.spec.ts via Playwright) - signup,
 *     login, contract create, upload, download, analytics, against a
 *     synthetic `@smoke-test.local` organization only.
 *
 * §Synthetic organization - the synthetic org/user created by step 2 is
 * ALWAYS deleted afterward (scripts/cleanup-smoke-data.ts), in a `finally`
 * so it runs even if either stage fails - a failed smoke run must never
 * leave synthetic data behind for the next run to collide with or for an
 * operator to mistake for real data.
 */
/** Inherits stdio (unlike server/backup/run-command.ts's buffered-stderr-only approach) so an operator watching `pnpm smoke` run sees Playwright's own live progress output, not just a final pass/fail line - this is an interactive/CI-log-streamed operator command, not a background job whose output only matters on failure. */
function runStep(label: string, execArgs: string[]): Promise<boolean> {
  console.log(`\n=== ${label} ===`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, execArgs, { cwd: repoRoot, stdio: "inherit", windowsHide: true });
    child.on("error", (error) => {
      console.error(`${label} 실행 자체에 실패했습니다: ${error.message}`);
      resolve(false);
    });
    child.on("close", (code) => {
      const ok = code === 0;
      console.log(ok ? `${label} 완료` : `${label} 실패 (exit ${code})`);
      resolve(ok);
    });
  });
}

/** `.ts` scripts (this repo's own CLI scripts) can't run directly under plain `node` - they need tsx's own loader for TS syntax + this project's `@/...` path aliases, same reason every other `pnpm x:y` script in package.json is `tsx scripts/....ts`. */
function tsxArgs(scriptRelativePath: string): string[] {
  return [resolvePackageBinEntry("tsx"), path.join(repoRoot, scriptRelativePath)];
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000";
  console.log(`[smoke] target: ${baseUrl}`);

  const infraOk = await runStep("인프라 smoke (live/ready)", tsxArgs("scripts/smoke-test.ts"));

  let goldenPathOk = false;
  if (infraOk) {
    const playwrightBin = resolvePackageBinEntry("@playwright/test", "playwright");
    goldenPathOk = await runStep("골든 패스 smoke (Playwright)", [playwrightBin, "test", "tests/e2e/smoke.spec.ts"]);
  } else {
    console.error("[smoke] 인프라 smoke가 실패해 golden-path smoke는 건너뜁니다.");
  }

  try {
    await runStep("synthetic 조직 정리", tsxArgs("scripts/cleanup-smoke-data.ts"));
  } catch (error) {
    console.error("[smoke] synthetic 조직 정리 중 오류:", error instanceof Error ? error.message : error);
  }

  if (!infraOk || !goldenPathOk) {
    console.error("\n[smoke] FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\n[smoke] PASS - 인프라 + golden path 모두 통과.");
}

main().catch((error: unknown) => {
  console.error("[smoke] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
