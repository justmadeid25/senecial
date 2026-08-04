import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyFailure, type FlakeCategory } from "../src/domain/testing/flake-classification";

interface PlaywrightResult {
  status: string;
  duration: number;
  error?: { message?: string };
}
interface PlaywrightTest {
  results: PlaywrightResult[];
}
interface PlaywrightSpec {
  title: string;
  file: string;
  tests: PlaywrightTest[];
}
interface PlaywrightSuite {
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}
interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
}

interface FlatTestResult {
  title: string;
  status: string;
  durationMs: number;
  errorMessage?: string;
}

function walkSuite(suite: PlaywrightSuite, out: FlatTestResult[]): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const lastResult = test.results[test.results.length - 1];
      out.push({
        title: `${spec.file} :: ${spec.title}`,
        status: lastResult?.status ?? "unknown",
        durationMs: lastResult?.duration ?? 0,
        errorMessage: lastResult?.error?.message,
      });
    }
  }
  for (const child of suite.suites ?? []) {
    walkSuite(child, out);
  }
}

interface RunFailure {
  test: string;
  category: FlakeCategory;
  rationale: string;
  errorMessage: string;
}

interface RunOutcome {
  runIndex: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: RunFailure[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const runsArg = args.find((arg) => arg.startsWith("--runs="));
  const specArg = args.find((arg) => arg.startsWith("--spec="));
  const projectArgs = args.filter((arg) => arg.startsWith("--project="));
  const parsedRuns = runsArg ? Number(runsArg.split("=")[1]) : 5;
  const runs = Number.isFinite(parsedRuns) && parsedRuns > 0 ? parsedRuns : 5;
  const spec = specArg ? specArg.split("=")[1] : undefined;
  // §Phase 12.3 Part B/C - `--prod` routes each iteration through
  // scripts/run-e2e-prod.ts (real `next start`, not `next dev`) instead
  // of a plain `playwright test` against the dev webServer - the
  // production-like counterpart to this same flake-repeat tool.
  const prod = args.includes("--prod");
  const skipBuild = args.includes("--skip-build");
  const projects = projectArgs.length > 0 ? projectArgs.map((arg) => arg.split("=")[1]!) : ["e2e-default", "e2e-queue"];
  const prodProject = projectArgs[0]?.split("=")[1] ?? "e2e-real-infra";
  return { runs, spec, projects, prod, skipBuild, prodProject };
}

/**
 * §Phase 12.2 Part B (§7 반복 실행 도구) - runs the E2E suite (or a single
 * `--spec`) N times, EACH through a full `tests/e2e/global-setup.ts` reset
 * (real DB isolation between iterations - no result is polluted by a
 * previous iteration's leftover data) and a unique `E2E_RUN_ID` (real
 * storage isolation - see playwright.config.ts). Every run's outcome is
 * recorded, not just the last one - a simple "re-run until it passes"
 * would hide exactly the flakiness this tool exists to surface.
 */
async function runOnce(
  runIndex: number,
  spec: string | undefined,
  projects: string[],
  options: { prod: boolean; skipBuild: boolean; prodProject: string }
): Promise<RunOutcome> {
  const runId = `repeat-${runIndex}-${Date.now()}`;
  const jsonOutputPath = path.join(process.cwd(), "tmp", "e2e-repeat-reports", `run-${runIndex}.json`);
  await mkdir(path.dirname(jsonOutputPath), { recursive: true });

  const start = performance.now();
  try {
    if (options.prod) {
      // §Phase 12.3 - run-e2e-prod.ts does its own DB reset internally
      // (and its own build, unless --skip-build - subsequent iterations
      // reuse the first iteration's build for speed, matching §10 Stage
      // 2/4's "여러 번 연속" intent without rebuilding every time).
      const buildFlag = options.skipBuild || runIndex > 1 ? "--skip-build" : "";
      const specArg = spec ? `--spec=${spec}` : "";
      execSync(
        `pnpm exec dotenv -e .env.e2e -- tsx scripts/run-e2e-prod.ts --project=${options.prodProject} ${buildFlag} ${specArg} --json-output=${jsonOutputPath}`,
        { env: { ...process.env, E2E_RUN_ID: runId }, stdio: ["ignore", "ignore", "inherit"] }
      );
    } else {
      const projectArgs = projects.map((p) => `--project=${p}`).join(" ");
      const specArg = spec ? ` ${spec}` : "";
      const command = `pnpm exec dotenv -e .env.e2e -- playwright test ${projectArgs}${specArg} --reporter=json`;
      // §9 - fresh deterministic reset before EVERY iteration, not just
      // once for the whole repeat run - a flake that only reproduces
      // against a specific pre-existing data state must not be masked by
      // reusing state left over from a PRIOR iteration.
      execSync("pnpm exec dotenv -e .env.e2e -- tsx scripts/e2e-db-reset.ts", { stdio: ["ignore", "ignore", "inherit"] });
      execSync(command, {
        env: { ...process.env, E2E_RUN_ID: runId, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputPath },
        stdio: ["ignore", "ignore", "inherit"],
      });
    }
  } catch {
    // Playwright exits non-zero on any test failure - the JSON report is
    // still written to jsonOutputPath regardless; only a truly broken
    // invocation (server never started, etc.) leaves no file, handled
    // below by the readFile catch.
  }
  const durationMs = performance.now() - start;

  let report: PlaywrightJsonReport;
  try {
    const raw = await readFile(jsonOutputPath, "utf8");
    report = JSON.parse(raw) as PlaywrightJsonReport;
  } catch {
    return {
      runIndex,
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs,
      failures: [
        {
          test: "(전체 실행)",
          category: "SERVER_STARTUP",
          rationale: "JSON 리포트 자체가 생성되지 않음 - webServer 기동 실패 또는 global-setup 실패 가능성",
          errorMessage: "",
        },
      ],
    };
  }

  const flat: FlatTestResult[] = [];
  for (const suite of report.suites ?? []) {
    walkSuite(suite, flat);
  }

  const failures: RunFailure[] = flat
    .filter((t) => t.status === "failed" || t.status === "timedOut")
    .map((t) => {
      const classification = classifyFailure(t.errorMessage ?? "");
      return {
        test: t.title,
        category: classification.category,
        rationale: classification.rationale,
        errorMessage: (t.errorMessage ?? "").slice(0, 500),
      };
    });

  return {
    runIndex,
    passed: flat.filter((t) => t.status === "passed").length,
    failed: failures.length,
    skipped: flat.filter((t) => t.status === "skipped").length,
    durationMs,
    failures,
  };
}

interface RepeatSummary {
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  avgDurationMs: number;
  p95DurationMs: number;
  flakyTests: Array<{ test: string; failureCount: number; categories: FlakeCategory[] }>;
  runs: RunOutcome[];
}

function renderMarkdown(summary: RepeatSummary, spec: string | undefined): string {
  const lines: string[] = [];
  lines.push("# E2E Flake 반복 실행 리포트 (Phase 12.2 §7/§8)");
  lines.push("");
  lines.push(`- 생성 시각: ${new Date().toISOString()}`);
  lines.push(`- 대상: ${spec ?? "전체 (e2e-default + e2e-queue)"}`);
  lines.push(`- 총 실행: ${summary.totalRuns}회, 성공: ${summary.successRuns}회, 실패 포함: ${summary.failureRuns}회`);
  lines.push(`- 평균 소요: ${(summary.avgDurationMs / 1000).toFixed(1)}초, p95: ${(summary.p95DurationMs / 1000).toFixed(1)}초`);
  lines.push("");

  lines.push("## Flaky 테스트 (실패가 1회 이상 발생)");
  lines.push("");
  if (summary.flakyTests.length === 0) {
    lines.push("없음 - 모든 실행에서 원인 미확정 실패 0건.");
  } else {
    lines.push("| 테스트 | 실패 횟수 | 분류 |");
    lines.push("| --- | --- | --- |");
    for (const flaky of summary.flakyTests) {
      lines.push(`| ${flaky.test} | ${flaky.failureCount}/${summary.totalRuns} | ${flaky.categories.join(", ")} |`);
    }
  }
  lines.push("");

  lines.push("## 실행별 상세");
  lines.push("");
  lines.push("| # | Passed | Failed | Skipped | 소요(초) |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const run of summary.runs) {
    lines.push(`| ${run.runIndex} | ${run.passed} | ${run.failed} | ${run.skipped} | ${(run.durationMs / 1000).toFixed(1)} |`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const { runs, spec, projects, prod, skipBuild, prodProject } = parseArgs();
  console.log(
    `E2E 반복 실행 시작 - ${runs}회${spec ? `, spec=${spec}` : ""}, ` +
      (prod ? `mode=production-like (project=${prodProject})` : `projects=${projects.join(",")}`)
  );

  const outcomes: RunOutcome[] = [];
  for (let i = 1; i <= runs; i += 1) {
    console.log(`\n[${i}/${runs}] 실행 중...`);
    const outcome = await runOnce(i, spec, projects, { prod, skipBuild, prodProject });
    outcomes.push(outcome);
    console.log(`  결과: passed=${outcome.passed}, failed=${outcome.failed}, skipped=${outcome.skipped}, ${(outcome.durationMs / 1000).toFixed(1)}초`);
    for (const failure of outcome.failures) {
      console.log(`    - [${failure.category}] ${failure.test}`);
    }
  }

  const totalRuns = outcomes.length;
  const successRuns = outcomes.filter((o) => o.failed === 0).length;
  const failureRuns = totalRuns - successRuns;
  const durations = outcomes.map((o) => o.durationMs).sort((a, b) => a - b);
  const avgDurationMs = durations.reduce((sum, v) => sum + v, 0) / durations.length;
  const p95DurationMs = durations[Math.min(durations.length - 1, Math.floor(0.95 * durations.length))] ?? 0;

  const failuresByTest = new Map<string, { count: number; categories: Set<FlakeCategory> }>();
  for (const outcome of outcomes) {
    for (const failure of outcome.failures) {
      const entry = failuresByTest.get(failure.test) ?? { count: 0, categories: new Set<FlakeCategory>() };
      entry.count += 1;
      entry.categories.add(failure.category);
      failuresByTest.set(failure.test, entry);
    }
  }

  const summary: RepeatSummary = {
    totalRuns,
    successRuns,
    failureRuns,
    avgDurationMs,
    p95DurationMs,
    flakyTests: [...failuresByTest.entries()].map(([test, entry]) => ({
      test,
      failureCount: entry.count,
      categories: [...entry.categories],
    })),
    runs: outcomes,
  };

  const reportDir = path.join(process.cwd(), "reports");
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "e2e-repeat-report.json"), JSON.stringify(summary, null, 2), "utf8");

  const markdown = renderMarkdown(summary, spec);
  await writeFile(path.join(reportDir, "e2e-repeat-report.md"), markdown, "utf8");

  console.log(`\n${markdown}`);
  console.log("리포트 저장 위치: reports/e2e-repeat-report.json / reports/e2e-repeat-report.md");

  if (failureRuns > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("E2E 반복 실행 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
