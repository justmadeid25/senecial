import { execSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import Redis from "ioredis";

/**
 * §Phase 12.4 §1/§8 - shared between `scripts/e2e-preflight.ts` (run
 * BEFORE the suite - fails fast, changes nothing) and
 * `scripts/e2e-verify-cleanup.ts` (run AFTER the suite - fails the suite
 * if state was left behind). Both need the exact same "is the environment
 * clean" definition; duplicating it would let them silently drift apart.
 */

export interface EnvironmentCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const E2E_TEST_EMAIL_DOMAINS = ["@e2e-test.local", "@smoke-test.local"];
const E2E_REDIS_KEY_PATTERN = "senecial-e2e-*";

/** Never logs the URL itself (embeds credentials) - only the database name it targets, matching e2e-db-reset.ts's own convention. */
function databaseNameOf(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, "");
}

export async function checkPortFree(port: string): Promise<EnvironmentCheckResult> {
  let output = "";
  try {
    output = execSync("netstat -ano", { encoding: "utf8" });
  } catch (error) {
    return { name: `port ${port} free`, ok: false, detail: `netstat 실행 실패: ${error instanceof Error ? error.message : error}` };
  }
  const listeningPids = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) listeningPids.add(pid);
  }
  if (listeningPids.size > 0) {
    return { name: `port ${port} free`, ok: false, detail: `포트 ${port}을(를) PID ${[...listeningPids].join(", ")}가 점유 중` };
  }
  return { name: `port ${port} free`, ok: true, detail: "미점유" };
}

export async function checkDedicatedE2eDatabase(databaseUrl: string): Promise<EnvironmentCheckResult> {
  const name = "E2E DB 전용성 및 연결";
  const dbName = databaseNameOf(databaseUrl);
  if (!dbName.includes("e2e")) {
    return { name, ok: false, detail: `DATABASE_URL이 "e2e" 전용 DB를 가리키지 않음 (database=${dbName}) - dev/test DB 오염 위험` };
  }
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { name, ok: true, detail: `연결 확인됨 (database=${dbName})` };
  } catch (error) {
    return { name, ok: false, detail: `연결 실패 (database=${dbName}): ${error instanceof Error ? error.message : error}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkE2eStorageEmpty(): Promise<EnvironmentCheckResult> {
  const name = "E2E storage 비어 있음";
  const dir = path.join(process.cwd(), "tmp", "e2e-storage");
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) {
      return { name, ok: true, detail: "tmp/e2e-storage 비어 있음" };
    }
    return { name, ok: false, detail: `tmp/e2e-storage에 이전 실행 잔여 디렉터리 ${entries.length}개 존재: ${entries.slice(0, 5).join(", ")}${entries.length > 5 ? "..." : ""}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { name, ok: true, detail: "tmp/e2e-storage 디렉터리 없음 (= 비어 있음)" };
    }
    return { name, ok: false, detail: `확인 실패: ${error instanceof Error ? error.message : error}` };
  }
}

/** §1 - safe to always clear: every entry under tmp/e2e-storage is a per-run-id throwaway directory (see playwright.config.ts's e2eStoragePath), never data a human could have intentionally placed there. */
export async function cleanupE2eStorage(): Promise<number> {
  const dir = path.join(process.cwd(), "tmp", "e2e-storage");
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
    return entries.length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/** §1 - safe to always clear: .test-mailbox is written only by the development mailer (see helpers/mailbox.ts) for E2E/smoke runs - never a real inbox. */
export async function cleanupTestMailbox(): Promise<number> {
  const dir = path.join(process.cwd(), ".test-mailbox");
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      await rm(path.join(dir, entry), { force: true });
    }
    return entries.length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function checkTestMailboxEmpty(): Promise<EnvironmentCheckResult> {
  const name = "test mailbox 비어 있음";
  const dir = path.join(process.cwd(), ".test-mailbox");
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) {
      return { name, ok: true, detail: ".test-mailbox 비어 있음" };
    }
    return { name, ok: false, detail: `.test-mailbox에 잔여 파일 ${entries.length}개 존재` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { name, ok: true, detail: ".test-mailbox 디렉터리 없음 (= 비어 있음)" };
    }
    return { name, ok: false, detail: `확인 실패: ${error instanceof Error ? error.message : error}` };
  }
}

export async function checkRedisPrefixClean(redisUrl: string): Promise<EnvironmentCheckResult> {
  const name = "Redis E2E prefix 정리됨";
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  try {
    await client.connect();
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, batch] = await client.scan(cursor, "MATCH", E2E_REDIS_KEY_PATTERN, "COUNT", 500);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < 10_000);
    if (keys.length === 0) {
      return { name, ok: true, detail: `"${E2E_REDIS_KEY_PATTERN}" 매칭 키 0건` };
    }
    return { name, ok: false, detail: `"${E2E_REDIS_KEY_PATTERN}" 매칭 잔여 키 ${keys.length}건 (예: ${keys.slice(0, 3).join(", ")})` };
  } catch (error) {
    return { name, ok: false, detail: `Redis 확인 실패: ${error instanceof Error ? error.message : error}` };
  } finally {
    client.disconnect();
  }
}

/** §8 - actively deletes leftover E2E-prefixed keys rather than just reporting them: every E2E Redis key is scoped to a disposable per-run prefix (senecial-e2e-*), never operator or long-lived data, so cleanup here can safely be destructive. */
export async function cleanupRedisPrefix(redisUrl: string): Promise<number> {
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000 });
  let deleted = 0;
  try {
    await client.connect();
    let cursor = "0";
    do {
      const [nextCursor, batch] = await client.scan(cursor, "MATCH", E2E_REDIS_KEY_PATTERN, "COUNT", 500);
      cursor = nextCursor;
      if (batch.length > 0) {
        deleted += await client.del(...batch);
      }
    } while (cursor !== "0");
  } finally {
    client.disconnect();
  }
  return deleted;
}

export async function checkNoTestOrganizations(databaseUrl: string): Promise<EnvironmentCheckResult> {
  const name = "테스트 조직 0건";
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const domainConditions = E2E_TEST_EMAIL_DOMAINS.map((_, i) => `u.email LIKE $${i + 1}`).join(" OR ");
    const params = E2E_TEST_EMAIL_DOMAINS.map((d) => `%${d}`);
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(DISTINCT o.id) AS count
       FROM "organizations" o
       JOIN "memberships" m ON m."organizationId" = o.id
       JOIN "users" u ON u.id = m."userId"
       WHERE ${domainConditions}`,
      params
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (count === 0) {
      return { name, ok: true, detail: "0건" };
    }
    return { name, ok: false, detail: `테스트 이메일 도메인 소속 조직 ${count}건 잔존` };
  } catch (error) {
    return { name, ok: false, detail: `확인 실패: ${error instanceof Error ? error.message : error}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkNoInProgressBatchExecution(databaseUrl: string): Promise<EnvironmentCheckResult> {
  const name = "실행 중 BatchExecution 없음";
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{ jobName: string; executionKey: string }>(
      `SELECT "jobName", "executionKey" FROM "batch_executions" WHERE status = 'RUNNING'`
    );
    if (result.rowCount === 0) {
      return { name, ok: true, detail: "0건" };
    }
    return {
      name,
      ok: false,
      detail: `RUNNING 상태 BatchExecution ${result.rowCount}건: ${result.rows.map((r) => `${r.jobName}(${r.executionKey})`).join(", ")}`,
    };
  } catch (error) {
    return { name, ok: false, detail: `확인 실패: ${error instanceof Error ? error.message : error}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** §1 - detects a benchmark/large-seed script (or another migrate) actively holding a long-running query against the SAME PostgreSQL instance the E2E DB lives on, which would otherwise silently steal I/O/CPU from the E2E run and produce misleading timeouts (see Phase 12.3's Run 2 resource-contention confound). Does not attempt to distinguish an ordinary slow query from a genuine contention source - any hit is surfaced for a human to judge, never auto-killed. */
export async function checkNoPostgresContention(databaseUrl: string): Promise<EnvironmentCheckResult> {
  const name = "PostgreSQL 동시 부하 없음";
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{ pid: number; application_name: string; state: string; query: string; seconds: number }>(
      `SELECT pid, application_name, state, LEFT(query, 120) AS query,
              EXTRACT(EPOCH FROM (now() - query_start))::int AS seconds
       FROM pg_stat_activity
       WHERE state = 'active'
         AND pid != pg_backend_pid()
         AND query NOT ILIKE '%pg_stat_activity%'
         AND EXTRACT(EPOCH FROM (now() - query_start)) > 3`
    );
    if (result.rowCount === 0) {
      return { name, ok: true, detail: "3초 이상 활성 쿼리 없음" };
    }
    return {
      name,
      ok: false,
      detail: `장시간 활성 쿼리 ${result.rowCount}건: ${result.rows
        .map((r) => `pid=${r.pid} app=${r.application_name || "?"} ${r.seconds}s`)
        .join("; ")}`,
    };
  } catch (error) {
    return { name, ok: false, detail: `확인 실패: ${error instanceof Error ? error.message : error}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** §1 - walks the Windows process table's ParentProcessId links from `pid` up to PID 0, returning every ancestor (including `pid` itself). Used to exclude the CURRENT script's own invocation chain (pnpm -> dotenv-cli -> tsx -> this process, or run-e2e-prod.ts -> preflight) from the "leftover process" scan below - those are not leftovers, they are the very run this check is gating. */
function getAncestorPids(pid: number): Set<number> {
  let output = "";
  try {
    output = execSync("wmic process get ProcessId,ParentProcessId /format:csv", { encoding: "utf8" });
  } catch {
    return new Set([pid]);
  }
  const parentOf = new Map<number, number>();
  for (const line of output.split("\n")) {
    const parts = line.trim().split(",");
    if (parts.length < 3) continue;
    const parentId = Number(parts[1]);
    const processId = Number(parts[2]);
    if (Number.isFinite(parentId) && Number.isFinite(processId)) {
      parentOf.set(processId, parentId);
    }
  }
  const ancestors = new Set<number>([pid]);
  let current = pid;
  for (let i = 0; i < 32; i += 1) {
    const parent = parentOf.get(current);
    if (parent === undefined || parent === 0 || ancestors.has(parent)) break;
    ancestors.add(parent);
    current = parent;
  }
  return ancestors;
}

/** §1 - looks for a node.exe process whose command line matches another `next start`/`next dev`/`playwright`/benchmark/backup invocation still running, which would compete for the same DB/Redis/filesystem. Excludes the current process's own ancestor chain (see getAncestorPids) - without that, this check flags the very orchestrator run (e.g. run-e2e-prod.ts) that invoked it as a "leftover", which is a false positive, not a real finding. Windows-only (uses wmic); returns ok:true with a note on other platforms rather than failing a check it cannot perform. */
export async function checkNoLeftoverNodeProcesses(excludePid: number): Promise<EnvironmentCheckResult> {
  const name = "이전 Node 프로세스 없음";
  if (process.platform !== "win32") {
    return { name, ok: true, detail: "win32가 아님 - 이 검사는 Windows 전용으로 건너뜀" };
  }
  const ownAncestors = getAncestorPids(process.pid);
  let output = "";
  try {
    output = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv', { encoding: "utf8" });
  } catch (error) {
    return { name, ok: false, detail: `wmic 실행 실패: ${error instanceof Error ? error.message : error}` };
  }
  const suspicious: string[] = [];
  const patterns = [/next start/i, /next dev/i, /playwright/i, /run-e2e-prod/i, /benchmark-/i, /disaster-recovery-drill/i, /restore-database/i];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(",");
    const pid = Number(parts[parts.length - 1]);
    const commandLine = parts.slice(1, -1).join(",");
    if (!pid || pid === excludePid || pid === process.pid || ownAncestors.has(pid)) continue;
    if (patterns.some((p) => p.test(commandLine))) {
      suspicious.push(`pid=${pid}: ${commandLine.slice(0, 100)}`);
    }
  }
  if (suspicious.length === 0) {
    return { name, ok: true, detail: "관련 잔여 프로세스 없음" };
  }
  return { name, ok: false, detail: `잔여 프로세스 ${suspicious.length}건: ${suspicious.join(" | ")}` };
}

export async function checkNoOrphanPortListener(port: string): Promise<EnvironmentCheckResult> {
  return checkPortFree(port);
}
