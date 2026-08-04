/**
 * Phase 10C - post-deploy smoke test (docs/operations/deployment.md).
 * Infra-level checks only (never touches customer data, never creates
 * users/organizations) - the full authenticated golden path (signup,
 * login, contract create, file upload/download, analytics, invitation,
 * mail delivery) is already covered end-to-end by the existing Playwright
 * suite under tests/e2e/, which this same smoke step also runs against
 * SMOKE_BASE_URL (see playwright.config.ts and docker-compose.yml's
 * `smoke-test` service) - not duplicated here.
 *
 * 1. Polls GET {BASE_URL}/api/health/live until it answers 200 (an app
 *    container can take a few seconds after `docker compose up` before
 *    its HTTP server is actually accepting connections).
 * 2. Calls GET {BASE_URL}/api/health/ready once live, and fails loudly if
 *    ANY dependency (database/storage/rateLimit/mail/config) is not ok -
 *    this is the same check /api/health/ready itself performs (see
 *    features/health/server/check-readiness.ts), re-run here as an
 *    external, black-box probe rather than trusting the app's own
 *    self-report from inside the container.
 *
 * Never prints a secret, host, path, bucket, or Redis URL - only the
 * per-check ok/error status this endpoint itself already exposes.
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000";
const LIVE_TIMEOUT_MS = Number(process.env.SMOKE_LIVE_TIMEOUT_MS ?? 60_000);
const LIVE_POLL_INTERVAL_MS = 2_000;

interface ReadinessBody {
  status: "ok" | "error";
  checks: Record<string, "ok" | "error">;
}

async function waitForLive(): Promise<void> {
  const deadline = Date.now() + LIVE_TIMEOUT_MS;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/live`);
      if (response.ok) {
        console.log(`[smoke-test] live: OK (${response.status})`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_INTERVAL_MS));
  }

  throw new Error(`/api/health/live never returned 200 within ${LIVE_TIMEOUT_MS}ms (last: ${lastError})`);
}

async function checkReady(): Promise<ReadinessBody> {
  const response = await fetch(`${BASE_URL}/api/health/ready`);
  const body = (await response.json()) as ReadinessBody;

  console.log(`[smoke-test] ready: HTTP ${response.status}, status=${body.status}`);
  for (const [name, status] of Object.entries(body.checks)) {
    console.log(`  - [${status === "ok" ? "PASS" : "FAIL"}] ${name}`);
  }

  if (body.status !== "ok" || !response.ok) {
    throw new Error("/api/health/ready reported a non-ok dependency - see checks above");
  }
  return body;
}

async function main() {
  console.log(`[smoke-test] target: ${BASE_URL}`);
  await waitForLive();
  await checkReady();
  console.log("[smoke-test] PASS - live + all readiness checks ok.");
}

main().catch((error: unknown) => {
  console.error("[smoke-test] FAIL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
