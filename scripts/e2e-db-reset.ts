import "dotenv/config";
import { execSync } from "node:child_process";

import { Client } from "pg";

/**
 * §Phase 12.2 Part B (§9 E2E DB isolation) - `pnpm test:e2e` runs this
 * BEFORE `playwright test` at the shell level (not as Playwright's
 * `globalSetup`) - Playwright starts `webServer` and waits for it to pass
 * its readiness check BEFORE running `globalSetup`, which would deadlock
 * here: the readiness check (`/api/health/ready`) queries the database,
 * but the database is only migrated/reset by this very script. Running it
 * as a separate step ahead of `playwright test` avoids that circular
 * dependency entirely, regardless of Playwright's internal ordering.
 *
 * Ensures the dedicated `senecial_e2e` database (never shared with dev
 * `.env` or Vitest's `.env.test` `senecial_test`) exists, is migrated,
 * and is DETERMINISTICALLY RESET (every app table truncated) before the
 * run starts - so a leftover row from a previous (possibly interrupted)
 * E2E run can never leak into this one. Cheaper than provisioning a brand
 * new database per run (§9's own fallback guidance: "실행별 DB 생성
 * 비용이 지나치게 크면 고정된 E2E DB를 사용하되 테스트 시작 전
 * deterministic reset을 수행하십시오").
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다 - .env.e2e를 통해 실행되었는지 확인하십시오.");
  }
  // Never log the URL itself (embeds credentials) - only which database name it targets.
  const targetDatabase = new URL(databaseUrl).pathname.replace(/^\//, "");
  console.log(`[e2e-db-reset] target database: ${targetDatabase}`);

  await ensureDatabaseExists(databaseUrl);

  console.log("[e2e-db-reset] running prisma migrate deploy...");
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" });

  console.log("[e2e-db-reset] resetting all application tables...");
  await truncateAllApplicationTables(databaseUrl);

  console.log("[e2e-db-reset] done.");
}

/** Connects to the `postgres` maintenance database (never the target itself - CREATE DATABASE cannot run inside the database being created) and creates the target if it does not already exist. Idempotent - safe to run on every E2E invocation, not just a fresh environment. */
async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const targetDatabase = url.pathname.replace(/^\//, "");
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = "/postgres";

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
    if (result.rowCount === 0) {
      console.log(`[e2e-db-reset] database "${targetDatabase}" does not exist - creating...`);
      // Database names cannot be parameterized - safe here because
      // targetDatabase comes from OUR OWN .env.e2e file, never user input.
      await client.query(`CREATE DATABASE "${targetDatabase}"`);
    }
  } finally {
    await client.end();
  }
}

const RESET_EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

async function truncateAllApplicationTables(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const tables = result.rows.map((row) => row.tablename).filter((name) => !RESET_EXCLUDED_TABLES.has(name));
    if (tables.length === 0) {
      return;
    }
    const quoted = tables.map((name) => `"${name}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    console.log(`[e2e-db-reset] truncated ${tables.length} tables.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[e2e-db-reset] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
