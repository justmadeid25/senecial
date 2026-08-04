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
 */
const smokeBaseUrl = process.env.SMOKE_BASE_URL;
const baseURL = smokeBaseUrl ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
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
          command: `pnpm exec dotenv -e .env.test -- next dev -p ${PORT}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 60_000,
          // .env.test hardcodes AUTH_URL/APP_URL to port 3000 for the normal dev
          // flow. Override them here so Auth.js resolves redirects (e.g.
          // signOut's redirectTo) against the actual port the E2E server runs
          // on - dotenv-cli does not overwrite env vars already set on the
          // process, so these take precedence over the .env.test values.
          env: {
            AUTH_URL: baseURL,
            APP_URL: baseURL,
          },
        },
      }),
});
