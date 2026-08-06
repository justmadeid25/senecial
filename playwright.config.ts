import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3100";

/**
 * Phase 10C - `SMOKE_BASE_URL` lets the exact same spec files under
 * tests/e2e run as a post-deploy smoke test against an already-running
 * target (a docker-compose'd container, a staging deployment) instead of
 * this config spawning its own throwaway `next dev` server - see
 * docs/operations/deployment.md's smoke-test step. Unset (the default,
 * local `pnpm test:e2e`) keeps the original self-hosted webServer
 * behavior unchanged.
 *
 * §Phase 12.2 Part B (§13 Production-like suite) - `SMOKE_BASE_URL` is
 * also how the `e2e-real-infra` project (see `projects` below) is meant
 * to be invoked: point it at a real `next build` + `next start` (or the
 * existing `docker compose --profile smoke` stack, see docker-compose.yml)
 * server, then run `pnpm exec playwright test --project=e2e-real-infra`.
 * This config does not itself spin up a production build automatically -
 * that lifecycle already exists via the docker-compose smoke profile and
 * scripts/smoke-test.ts; this project reuses it rather than duplicating
 * it.
 */
const smokeBaseUrl = process.env.SMOKE_BASE_URL;
const baseURL = smokeBaseUrl ?? `http://localhost:${PORT}`;

/**
 * §Phase 12.2 Part B (§10 File storage isolation) - a fresh directory per
 * E2E invocation, never the same `./storage` dev/test/benchmark scripts
 * write to. `E2E_RUN_ID` lets the repeat-runner (scripts/e2e-repeat-runner.ts)
 * assign a distinct id per iteration; a bare `pnpm test:e2e` falls back to
 * a timestamp+pid so two manual runs never collide either.
 */
const e2eRunId = process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}`;
const e2eStoragePath = path.join("tmp", "e2e-storage", e2eRunId);

// Same class of bug as scripts/run-e2e-prod.ts's TEST_MAILBOX_DIR/
// LOCAL_STORAGE_PATH threading (see that file's own comments): this
// e2eStoragePath value was previously only passed to the spawned
// webServer's own env below, never to this top-level process. Spec-file
// helpers that shell out to a worker CLI via execFileSync (e.g.
// runExtractionWorker() in extraction-flow.spec.ts) inherit *this*
// process's env, not the webServer child's - without this line they'd
// fall back to .env.e2e's static LOCAL_STORAGE_PATH=./storage default
// and look in the wrong directory for files the dev server actually
// wrote to tmp/e2e-storage/{e2eRunId}. Setting it here, before Playwright
// spawns any test workers, makes every process in the tree agree on the
// one real directory.
process.env.LOCAL_STORAGE_PATH = e2eStoragePath;

/**
 * §Phase 12.2 Part B (§12 Worker policy) - three projects, not one:
 *
 *  - `e2e-default`: independent per-organization CRUD/read flows (auth,
 *    account security, contracts, counterparties, invitations,
 *    analytics-read) - safe to run with real parallelism since each spec
 *    creates its own org/user and never touches a GLOBAL (non-org-scoped)
 *    queue or worker.
 *  - `e2e-queue`: specs that invoke a worker CLI processing function
 *    (extraction/segmentation/embedding/mail) which claims the globally
 *    oldest PENDING job across the whole database (FOR UPDATE SKIP
 *    LOCKED, not org-scoped - mirrors vitest.config.ts's identical
 *    `queue` project rationale for the same underlying job-claim
 *    functions), or that create the "smoke synthetic organization" this
 *    spec's own name reserves. `workers: 1` - never parallel.
 *  - `e2e-real-infra`: same spec set, meant to run against a production
 *    build (`SMOKE_BASE_URL`, see above) - not part of the default local
 *    `pnpm test:e2e` invocation, used for the nightly/release-gate
 *    production-like pass (§13).
 */
const QUEUE_SPECS = [
  "tests/e2e/ai-conversation-flow.spec.ts",
  "tests/e2e/clause-intelligence-flow.spec.ts",
  "tests/e2e/extraction-flow.spec.ts",
  "tests/e2e/mail-delivery-flow.spec.ts",
  "tests/e2e/smoke.spec.ts",
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: [["list"]],
  // §Phase 12.2 Part B (§9) - deterministic E2E-only DB reset runs BEFORE
  // this config is even loaded (see package.json's `test:e2e` script and
  // scripts/e2e-db-reset.ts) - NOT as Playwright's own `globalSetup`,
  // which runs AFTER `webServer` already passed its readiness check
  // (`/api/health/ready` queries the very database this reset prepares -
  // using `globalSetup` for it deadlocks the webServer readiness wait).
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e-default",
      testIgnore: QUEUE_SPECS,
      // §Phase 12.2 Part B (§12/§39) - MEASURED, not assumed: `workers: 2`
      // + `fullyParallel: true` was tried against this project first and
      // caused real `next dev` (Turbopack) dev-server crashes -
      // "Jest worker encountered N child process exceptions, exceeding
      // retry limit" - which cascaded into spurious CredentialsSignin
      // auth failures across unrelated specs. This is a genuine
      // regression from parallelism itself, not a pre-existing flake (it
      // reproduced immediately on the very first parallel run and never
      // occurred at workers:1) - see docs/operations/ai-platform.md-style
      // honesty requirement: reverted to serial rather than ship a
      // "parallel" project that silently corrupts other specs' results.
      // These specs ARE still logically independent per-organization
      // flows (safe to parallelize against multiple INDEPENDENT dev
      // server instances, e.g. one per CI shard) - the constraint is
      // specifically "one shared `next dev` process, multiple workers",
      // not the specs' own design.
      fullyParallel: false,
      workers: 1,
      timeout: 30_000,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-queue",
      testMatch: QUEUE_SPECS,
      fullyParallel: false,
      workers: 1,
      // §Phase 12.2 Part B (§15) - longer than e2e-default: these specs
      // include real worker-CLI processing (extraction/segmentation/
      // embedding/mail) on top of ordinary UI navigation, not just UI
      // navigation alone.
      timeout: 60_000,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-real-infra",
      testMatch: [...QUEUE_SPECS, "tests/e2e/**/*.spec.ts"],
      fullyParallel: false,
      workers: 1,
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Omitted entirely (rather than pointed at a no-op command) when
  // SMOKE_BASE_URL targets an already-running server - Playwright only
  // manages a webServer lifecycle when this key is present at all.
  ...(smokeBaseUrl
    ? {}
    : {
        webServer: {
          command: `pnpm exec dotenv -e .env.e2e -- next dev -p ${PORT}`,
          // §Phase 12.2 Part B (§14 Web server readiness) - a real
          // application-level readiness probe (DB/storage/rate-limit/
          // mail/config/batch/vectorSearch all checked - see
          // src/features/health/server/check-readiness.ts), not just "the
          // TCP port accepted a connection" or "any HTTP response at /" -
          // a server that is listening but still mid-migration or unable
          // to reach its DB must never be treated as ready.
          url: `${baseURL}/api/health/ready`,
          reuseExistingServer: false,
          timeout: 60_000,
          // .env.e2e hardcodes AUTH_URL/APP_URL to port 3000 for the normal dev
          // flow. Override them here so Auth.js resolves redirects (e.g.
          // signOut's redirectTo) against the actual port the E2E server runs
          // on - dotenv-cli does not overwrite env vars already set on the
          // process, so these take precedence over the .env.e2e values.
          env: {
            AUTH_URL: baseURL,
            APP_URL: baseURL,
            // §Phase 12.2 Part B (§10) - per-run storage isolation, see
            // e2eStoragePath's own comment above.
            LOCAL_STORAGE_PATH: e2eStoragePath,
            E2E_RUN_ID: e2eRunId,
          },
        },
      }),
});
