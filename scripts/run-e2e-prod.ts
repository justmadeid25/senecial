import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * §Phase 12.3 Part B - production-like E2E orchestrator. Distinct from
 * `next dev` (`scripts/e2e-db-reset.ts` + `playwright test`, still
 * available as `pnpm test:e2e:dev` for fast local iteration): this runs
 * the REAL production Next.js server code path (`next start`, which
 * unconditionally sets NODE_ENV=production - see
 * domain/production-readiness/validate-environment.ts's
 * ALLOW_HTTP_IN_PRODUCTION_TESTING for why that needs one explicit,
 * test-only override), never Turbopack's dev-mode compilation workers
 * (the suspected - not confirmed, see docs/operations/e2e-testing.md -
 * source of the `next dev` crashes found in Phase 12.2).
 *
 * §6/§7 flow: E2E DB reset -> (optional) build -> spawn `next start` ->
 * live/ready polling -> Playwright against the running server
 * (`SMOKE_BASE_URL`) -> graceful shutdown with a Windows process-tree
 * force-kill fallback -> report.
 */

const PORT = process.env.E2E_PROD_PORT ?? "3300";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LIVE_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_CAPTURED_LOG_LINES = 300;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    skipBuild: args.includes("--skip-build"),
    project: args.find((a) => a.startsWith("--project="))?.split("=")[1] ?? "e2e-real-infra",
    spec: args.find((a) => a.startsWith("--spec="))?.split("=")[1],
    jsonOutput: args.find((a) => a.startsWith("--json-output="))?.split("=")[1],
  };
}

interface ReadinessBody {
  status: "ok" | "error";
  checks?: Record<string, "ok" | "error">;
}

async function waitForLive(): Promise<void> {
  const deadline = Date.now() + LIVE_TIMEOUT_MS;
  let lastError = "no attempt yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/live`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`live 상태가 되지 않음 (마지막 오류: ${lastError})`);
}

async function waitForReady(): Promise<ReadinessBody> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastBody: ReadinessBody | undefined;
  let lastError = "no attempt yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      const body = (await response.json()) as ReadinessBody;
      lastBody = body;
      if (response.ok && body.status === "ok") return body;
      lastError = `status=${body.status}, checks=${JSON.stringify(body.checks)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`ready 상태가 되지 않음 (마지막: ${lastError})${lastBody ? `, last body: ${JSON.stringify(lastBody)}` : ""}`);
}

/**
 * §7 - Windows-specific port-based cleanup safety net (see stopServer()'s
 * own comment for why this is necessary, not just defensive). Parses
 * `netstat -ano` for a LISTENING socket on `port` and force-kills whatever
 * PID owns it. A no-op (never throws) if nothing is listening - the
 * common, expected case when the graceful/PID-based kill already worked.
 */
async function killAnyProcessOnPort(port: string): Promise<void> {
  let output = "";
  try {
    output = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return;
  }
  const pids = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    const match = line.match(new RegExp(`[:.]${port}\\s`));
    if (!match) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }
  for (const pid of pids) {
    console.log(`[e2e-prod] port ${port} still held by PID ${pid} after graceful stop - force-killing.`);
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Already gone - fine.
    }
  }
}

async function main(): Promise<void> {
  const { skipBuild, project, spec, jsonOutput } = parseArgs();
  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}`;
  console.log(`[e2e-prod] run id: ${runId}, project: ${project}${spec ? `, spec: ${spec}` : ""}`);

  console.log("[e2e-prod] resetting E2E database...");
  execSync("pnpm exec tsx scripts/e2e-db-reset.ts", { stdio: "inherit" });

  if (!skipBuild) {
    console.log("[e2e-prod] building (next build)...");
    execSync("pnpm exec next build", { stdio: "inherit" });
  } else {
    console.log("[e2e-prod] --skip-build set, reusing the existing .next build.");
  }

  const storagePath = path.join(process.cwd(), "tmp", "e2e-storage", `prod-${runId}`);
  await mkdir(storagePath, { recursive: true });

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT,
    HOSTNAME: "127.0.0.1",
    AUTH_URL: BASE_URL,
    APP_URL: BASE_URL,
    LOCAL_STORAGE_PATH: storagePath,
    // §5/§6 - this server run is deliberately production-like (NODE_ENV
    // forced to "production" by `next start` itself), so every ALLOW_*
    // override below is the SAME explicit, logged, opt-in escape hatch a
    // real operator would need - never a silent default. See
    // ALLOW_HTTP_IN_PRODUCTION_TESTING's own docstring for why that one
    // specifically may NEVER be used for a real deployment.
    ALLOW_HTTP_IN_PRODUCTION_TESTING: "true",
    ALLOW_DEVELOPMENT_INVITATION_MAILER: "true",
    ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER: "true",
    ALLOW_NOOP_MALWARE_SCANNER: "true",
    ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER: "true",
    ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER: "true",
    ALLOW_UNENCRYPTED_BACKUP: "true",
    ALLOW_DEVELOPMENT_AI_PROVIDER: "true",
    // §Phase 12.3 Part D - real Redis, not memory - this run doubles as
    // Redis integration exercise for the concurrency limiter/distributed
    // lock/cache provider (see docs/operations/e2e-testing.md). Unique
    // key prefix per run - never shares keys with dev/other E2E runs.
    RATE_LIMITER: process.env.RATE_LIMITER ?? "redis",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    REDIS_KEY_PREFIX: `clausebase-e2e-prod-${runId}`,
    AI_CACHE_PROVIDER: process.env.AI_CACHE_PROVIDER ?? "redis",
  };

  console.log(`[e2e-prod] starting production server (next start) on port ${PORT}...`);
  const capturedLogLines: string[] = [];
  function captureOutput(buf: Buffer): void {
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      capturedLogLines.push(line);
      if (capturedLogLines.length > MAX_CAPTURED_LOG_LINES) capturedLogLines.shift();
    }
  }

  const child = spawn("pnpm", ["exec", "next", "start", "-p", PORT, "-H", "127.0.0.1"], {
    env: serverEnv,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", captureOutput);
  child.stderr?.on("data", captureOutput);

  let intentionalStop = false;
  let serverCrashed = false;
  let crashExitCode: number | null = null;
  child.on("exit", (code) => {
    if (!intentionalStop && code !== 0 && code !== null) {
      serverCrashed = true;
      crashExitCode = code;
    }
  });

  /** §7 - graceful first (SIGTERM-equivalent), then a Windows process-tree force-kill fallback so no orphan `next start`/child compiler process survives this script. */
  async function stopServer(): Promise<void> {
    intentionalStop = true;
    console.log("[e2e-prod] stopping server...");
    if (child.exitCode === null && child.pid !== undefined) {
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (child.exitCode === null) {
        try {
          execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
        } catch {
          // Already gone by the time taskkill ran - not an error.
        }
      }
    }
    // §7 - REAL orphan found during Phase 12.3 verification: `spawn(...,
    // { shell: true })` on Windows makes `child.pid` the PID of the CMD
    // shell wrapper, not the actual `next start` server process underneath
    // it - killing the shell does NOT reliably kill that grandchild, which
    // survived holding the port even after `child.exitCode` reported
    // non-null. This port-based sweep is the actual guarantee: whatever
    // process (if any) is still LISTENING on PORT after the steps above is
    // force-killed directly, regardless of any PID-tracking mismatch.
    await killAnyProcessOnPort(PORT);
  }

  function dumpCapturedLogs(): void {
    console.error(`[e2e-prod] last ${capturedLogLines.length} captured server log lines:`);
    console.error(capturedLogLines.join("\n"));
  }

  try {
    await waitForLive();
    const readyBody = await waitForReady();
    console.log(`[e2e-prod] server ready: ${JSON.stringify(readyBody)}`);
  } catch (error) {
    console.error(`[e2e-prod] server never became ready: ${error instanceof Error ? error.message : error}`);
    dumpCapturedLogs();
    await stopServer();
    process.exitCode = 1;
    return;
  }

  console.log(`[e2e-prod] running Playwright against ${BASE_URL} (project=${project})...`);
  const playwrightArgs = ["exec", "playwright", "test", `--project=${project}`];
  if (jsonOutput) playwrightArgs.push("--reporter=json");
  if (spec) playwrightArgs.push(spec);

  let playwrightExitCode = 0;
  try {
    execSync(`pnpm ${playwrightArgs.join(" ")}`, {
      stdio: jsonOutput ? ["ignore", "ignore", "inherit"] : "inherit",
      env: { ...process.env, SMOKE_BASE_URL: BASE_URL, ...(jsonOutput ? { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutput } : {}) },
    });
  } catch (error) {
    playwrightExitCode = (error as { status?: number }).status ?? 1;
  }

  await stopServer();

  if (serverCrashed) {
    console.error(`[e2e-prod] SERVER CRASHED during the run (exit code ${crashExitCode})`);
    dumpCapturedLogs();
    process.exitCode = 1;
    return;
  }

  console.log(`[e2e-prod] done. Playwright exit code: ${playwrightExitCode}`);
  process.exitCode = playwrightExitCode;
}

main().catch((error: unknown) => {
  console.error("[e2e-prod] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
