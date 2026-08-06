import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanupE2eStorage, cleanupRedisPrefix, cleanupTestMailbox } from "./lib/e2e-environment-checks";

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
// §Phase 12.4 §2 - 300 was too small to be useful for root-causing a
// failure anywhere but the very end of a multi-minute, 101-test run (the
// captured buffer is a ring buffer - by the time a run finishes, only the
// LAST ~300 lines survive, discarding everything from earlier tests
// entirely). Raised substantially so a failure early or mid-run still has
// its own server-side log context available in the persisted log file.
const MAX_CAPTURED_LOG_LINES = 20_000;

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
 * §7 - cross-platform port-based cleanup safety net (see stopServer()'s own
 * comment for why this is necessary, not just defensive). Force-kills
 * whatever process is still LISTENING on `port` after the graceful/PID-based
 * stop. A no-op (never throws) if nothing is listening - the common,
 * expected case when the graceful stop already worked.
 *
 * §Phase 12.5 - REAL bug found here on the first actual GitHub Actions run:
 * this was Windows-only (`netstat -ano` + `taskkill`) with no Linux/macOS
 * equivalent, so on CI the orphaned standalone `node server.js` (see
 * stopServer()'s own comment on why `shell: true` can leave one behind)
 * was NEVER actually reaped. That orphan inherited this step's stdout/
 * stderr pipe, which GitHub Actions keeps a job step "running" on until
 * every process holding it exits - not just the main script process. The
 * `run-e2e-prod.ts` script itself finished normally in ~10 minutes
 * (confirmed via its own "[e2e-prod] done." log line), but the CI *step*
 * then hung for hours behind that orphan until the platform's default
 * 360-minute job timeout finally killed it - this is why every single
 * prior CI run of this workflow, going back through this repo's full
 * history, failed after ~6 hours instead of the ~10 minutes local runs
 * take.
 */
async function killAnyProcessOnPort(port: string): Promise<void> {
  if (process.platform === "win32") {
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
    return;
  }

  // Linux/macOS: `lsof -ti` prints just the PIDs of whatever is bound to
  // this TCP port (LISTEN or otherwise) - the direct equivalent of the
  // Windows branch above. `lsof` is preinstalled on GitHub-hosted Ubuntu
  // and macOS runners; falls back to `fuser` (also commonly present on
  // Linux) if `lsof` itself is missing, rather than silently doing nothing.
  let pidsOutput = "";
  try {
    pidsOutput = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" });
  } catch (error) {
    // `lsof` exits non-zero (throwing here) when NOTHING matches - the
    // common, expected case. Only fall back to `fuser` if `lsof` itself
    // could not run at all (e.g. command not found), not merely "no match".
    if ((error as { stdout?: string }).stdout !== undefined) return;
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
    } catch {
      // Neither tool available or nothing to kill - fine, best-effort.
    }
    return;
  }
  const pids = pidsOutput.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  for (const pid of pids) {
    console.log(`[e2e-prod] port ${port} still held by PID ${pid} after graceful stop - force-killing.`);
    try {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    } catch {
      // Already gone - fine.
    }
  }
}

async function main(): Promise<void> {
  const { skipBuild, project, spec, jsonOutput } = parseArgs();
  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}`;
  console.log(`[e2e-prod] run id: ${runId}, project: ${project}${spec ? `, spec: ${spec}` : ""}`);

  // §Phase 12.4 §1 - fail fast, before touching the DB or building
  // anything, if the environment is not clean (port occupied, DB not
  // dedicated, Postgres/Redis contention, leftover processes). A run
  // that starts anyway risks exactly the resource-contention confound
  // that made Phase 12.3's second run uninterpretable.
  if (process.env.E2E_SKIP_PREFLIGHT !== "true") {
    console.log("[e2e-prod] running preflight checks...");
    execSync("pnpm exec tsx scripts/e2e-preflight.ts", { stdio: "inherit" });
  }

  console.log("[e2e-prod] resetting E2E database...");
  execSync("pnpm exec tsx scripts/e2e-db-reset.ts", { stdio: "inherit" });

  if (!skipBuild) {
    console.log("[e2e-prod] building (next build)...");
    execSync("pnpm exec next build", { stdio: "inherit" });
  } else {
    console.log("[e2e-prod] --skip-build set, reusing the existing .next build.");
  }

  // §Phase 12.4 §2 - REAL bug found here: `next start` prints (and this
  // project ignored) "next start does not work with output: standalone
  // configuration. Use node .next/standalone/server.js instead." -
  // Next.js's own warning was correct: `next start` served pages/APIs
  // fine, but every real file-upload E2E test (Server Action + multipart
  // FormData) hung indefinitely with the upload button stuck "업로드 중..."
  // and no server-side error ever logged, while every non-upload test
  // passed - exactly the shape of a request-body-handling gap specific to
  // running the wrong server entrypoint against a standalone build. The
  // Dockerfile's own `runner` stage (the actual verified production path -
  // see its own header comment) has ALWAYS used `node server.js` from
  // `.next/standalone/`, never `next start` - this now matches that exact,
  // already-verified path instead of an unverified shortcut.
  console.log("[e2e-prod] assembling standalone server output...");
  execSync("node scripts/docker-copy-instrumentation.mjs", { stdio: "inherit" });
  const standaloneDir = path.join(process.cwd(), ".next", "standalone");
  await rm(path.join(standaloneDir, ".next", "static"), { recursive: true, force: true });
  await cp(path.join(process.cwd(), ".next", "static"), path.join(standaloneDir, ".next", "static"), { recursive: true });
  await rm(path.join(standaloneDir, "public"), { recursive: true, force: true });
  await cp(path.join(process.cwd(), "public"), path.join(standaloneDir, "public"), { recursive: true });

  const storagePath = path.join(process.cwd(), "tmp", "e2e-storage", `prod-${runId}`);
  await mkdir(storagePath, { recursive: true });

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT,
    HOSTNAME: "127.0.0.1",
    AUTH_URL: BASE_URL,
    APP_URL: BASE_URL,
    LOCAL_STORAGE_PATH: storagePath,
    // §Phase 12.4 §2 - REAL bug found here: without this, test-mailbox.ts
    // (running inside the spawned server, cwd = standaloneDir below) wrote
    // to `.next/standalone/.test-mailbox`, invisible to the Playwright
    // reader running from the repo root - every mail-delivery-flow.spec.ts
    // test timed out. Computed from THIS process's cwd (already the repo
    // root), not the server's - see test-mailbox.ts's own comment.
    TEST_MAILBOX_DIR: path.join(process.cwd(), ".test-mailbox"),
    // §Phase 12.4 §2 - `node server.js` (unlike `next start`) does NOT
    // force NODE_ENV itself - this must be set explicitly to keep the run
    // genuinely production-like (matches the Dockerfile runner stage's own
    // `ENV NODE_ENV=production`).
    NODE_ENV: "production",
    // §5/§6 - this server run is deliberately production-like, so every
    // ALLOW_* override below is the SAME explicit, logged, opt-in escape
    // hatch a real operator would need - never a silent default. See
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
    REDIS_KEY_PREFIX: `senecial-e2e-prod-${runId}`,
    AI_CACHE_PROVIDER: process.env.AI_CACHE_PROVIDER ?? "redis",
  };

  console.log(`[e2e-prod] starting production server (node .next/standalone/server.js) on port ${PORT}...`);
  const capturedLogLines: string[] = [];
  function captureOutput(buf: Buffer): void {
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      capturedLogLines.push(line);
      if (capturedLogLines.length > MAX_CAPTURED_LOG_LINES) capturedLogLines.shift();
    }
  }

  // §Phase 12.4 §2 - runs the SAME entrypoint the Dockerfile's `runner`
  // stage runs (`node server.js`, cwd = the standalone output directory) -
  // not `next start`, which Next.js itself warns is incompatible with
  // `output: "standalone"` and which caused the real file-upload hang
  // documented above.
  const child = spawn("node", ["server.js"], {
    cwd: standaloneDir,
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

  // §Phase 12.4 §2 - server logs must be available for root-cause analysis
  // of an ORDINARY Playwright test failure too, not only a server crash or
  // a never-became-ready failure (the only two paths dumpCapturedLogs() was
  // previously reachable from) - without this, a failure like "file upload
  // button stayed disabled" left no way to check whether the SERVER saw
  // anything unusual during that request. Always written, pass or fail, to
  // a fixed path so the caller/CI can pick it up as an artifact regardless
  // of outcome.
  async function persistCapturedLogs(): Promise<void> {
    const logPath = path.join(process.cwd(), "reports", "e2e-prod-server.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, capturedLogLines.join("\n"), "utf8");
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

  // §Phase 12.4 §10 - REAL cold/warm gap found here: a freshly-spawned
  // `node server.js` answers its FIRST few real requests measurably slower
  // than its 60th (V8 JIT has not yet optimized hot paths, the OS file
  // cache holds none of .next/standalone's chunk files yet, Prisma's
  // query-compiler has not yet compiled these query shapes) - direct
  // repeated measurement of the exact same "upload a file, wait for it to
  // appear" step against this same build showed ~33.7s/33.4s/32.3s when it
  // was among the first real page loads after startup, vs 3.6s for the
  // logically identical step ~60 tests into the same server's lifetime
  // (see tests/e2e/counterparties-and-files-flow.spec.ts, which never
  // failed). pg_stat_activity showed no blocked/slow query during a slow
  // run and the server's own request log showed nothing pathological
  // either - this is JIT/cache warm-up wall-clock time, not a stuck
  // request or a code bug. A handful of cheap, unauthenticated GETs here
  // (before Playwright's very first test) pays that one-time cost ONCE, up
  // front, so every real test - including the first - already runs
  // "warm", rather than each spec file's own first heavy interaction
  // silently eating an unpredictable, sometimes-timeout-busting chunk of
  // this cost.
  console.log("[e2e-prod] warming up server (JIT/OS cache) before Playwright...");
  for (const warmupPath of ["/", "/login", "/signup", "/forgot-password"]) {
    try {
      await fetch(`${BASE_URL}${warmupPath}`);
    } catch {
      // Best-effort - a warm-up request failing is not itself a test
      // failure; the real tests below will surface any genuine problem.
    }
  }

  console.log(`[e2e-prod] running Playwright against ${BASE_URL} (project=${project})...`);
  const playwrightArgs = ["exec", "playwright", "test", `--project=${project}`];
  if (jsonOutput) playwrightArgs.push("--reporter=json");
  if (spec) playwrightArgs.push(spec);

  let playwrightExitCode = 0;
  try {
    execSync(`pnpm ${playwrightArgs.join(" ")}`, {
      stdio: jsonOutput ? ["ignore", "ignore", "inherit"] : "inherit",
      env: {
        ...process.env,
        SMOKE_BASE_URL: BASE_URL,
        // Same value as serverEnv.TEST_MAILBOX_DIR above - provably the
        // same directory the server just wrote to, not two independent
        // process.cwd()-based computations that happen to coincide.
        TEST_MAILBOX_DIR: serverEnv.TEST_MAILBOX_DIR,
        ...(jsonOutput ? { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutput } : {}),
      },
    });
  } catch (error) {
    playwrightExitCode = (error as { status?: number }).status ?? 1;
  }

  await stopServer();
  await persistCapturedLogs();

  if (serverCrashed) {
    console.error(`[e2e-prod] SERVER CRASHED during the run (exit code ${crashExitCode})`);
    dumpCapturedLogs();
    process.exitCode = 1;
    return;
  }

  // §Phase 12.4 §8 - the suite's own responsibility to leave 0 test
  // organizations/data/storage/mailbox/Redis-key state behind, not
  // something deferred to the NEXT run's pre-flight reset. Reuses
  // e2e-db-reset.ts's truncate (idempotent - migrate deploy is a no-op
  // when already up to date) as this run's own teardown, distinct in
  // intent from its use as a PRE-run reset.
  console.log("[e2e-prod] post-run cleanup (DB truncate, storage, mailbox, Redis prefix)...");
  execSync("pnpm exec tsx scripts/e2e-db-reset.ts", { stdio: "inherit" });
  const storageDeleted = await cleanupE2eStorage();
  const mailboxDeleted = await cleanupTestMailbox();
  const redisDeleted = await cleanupRedisPrefix(serverEnv.REDIS_URL!);
  console.log(`[e2e-prod] cleaned: storage dirs=${storageDeleted}, mailbox files=${mailboxDeleted}, redis keys=${redisDeleted}`);

  // §Phase 12.4 §8 - a cleanup failure is as severe as a test failure:
  // it means this run leaked state (storage, Redis keys, mailbox files,
  // an in-progress BatchExecution, an orphan process) that could corrupt
  // the NEXT run's results. Runs even when Playwright itself already
  // failed, so a real failure never masks a cleanup problem.
  console.log("[e2e-prod] verifying cleanup...");
  let cleanupExitCode = 0;
  try {
    execSync("pnpm exec tsx scripts/e2e-verify-cleanup.ts", { stdio: "inherit" });
  } catch (error) {
    cleanupExitCode = (error as { status?: number }).status ?? 1;
  }

  const finalExitCode = playwrightExitCode !== 0 ? playwrightExitCode : cleanupExitCode;
  console.log(`[e2e-prod] done. Playwright exit code: ${playwrightExitCode}, cleanup exit code: ${cleanupExitCode}`);
  process.exitCode = finalExitCode;

  // §Phase 12.5 - REAL bug found here on GitHub Actions: setting
  // `process.exitCode` alone lets Node wait for the event loop to drain
  // naturally, but `child.stdout?.on("data", captureOutput)` above keeps
  // this process's stdout/stderr pipe open for as long as ANY process
  // still holds the write end - including an orphaned grandchild that
  // `shell: true` left behind (see stopServer()'s own comment) even after
  // killAnyProcessOnPort() reaped whatever was actually LISTENING on
  // PORT. On this host (Windows) that pipe is inherited differently and
  // this was never observed; on GitHub Actions' Linux runners it measurably
  // hung this exact script for 30+ minutes past its own "done" log line,
  // with the underlying work (build + all 101 tests + cleanup) already
  // finished in ~10 minutes matching local timing - explaining why every
  // prior CI run of e2e-production-like/release:verify timed out at
  // GitHub's ~6-hour job ceiling instead of finishing. An explicit
  // `process.exit()` forces this process to terminate immediately
  // regardless of any lingering open handle, which is what actually ends
  // the CI step - `killAnyProcessOnPort()` above still matters
  // independently (it prevents a real zombie server process from wasting
  // runner resources or holding the port for a subsequent invocation).
  process.exit(finalExitCode);
}

main().catch((error: unknown) => {
  console.error("[e2e-prod] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
