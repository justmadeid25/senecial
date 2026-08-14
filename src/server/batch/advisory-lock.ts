import { Client } from "pg";

export interface AdvisoryLockHandle {
  acquired: boolean;
  release(): Promise<void>;
}

/**
 * Deployment note (Neon/PgBouncer) - a SESSION-level advisory lock is only
 * meaningful if `pg_try_advisory_lock` and the later `pg_advisory_unlock`
 * run on the exact same backend Postgres session. `DATABASE_URL` may point
 * at a transaction-pooling connection pooler (e.g. Neon's default pooled
 * endpoint, PgBouncer in transaction mode) where a single client's
 * queries can silently be routed to different backend sessions between
 * calls - which would make this lock unreliable without ever raising an
 * error. `DATABASE_URL_UNPOOLED` (a direct, non-pooled connection - Neon
 * always provides one alongside the pooled `DATABASE_URL`) is required in
 * production for this reason; see resolveAdvisoryLockConnectionString().
 */
export function resolveAdvisoryLockConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const unpooled = env.DATABASE_URL_UNPOOLED;
  if (unpooled) {
    return unpooled;
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL_UNPOOLED이 설정되지 않았습니다 - production에서는 session-level advisory lock이 " +
        "pooled DATABASE_URL(PgBouncer transaction pooling 등)로 조용히 대체될 수 없습니다. " +
        "직접(non-pooled) Postgres 연결 문자열을 DATABASE_URL_UNPOOLED에 설정하십시오."
    );
  }

  // development/test only - local docker-compose Postgres has no pooler at
  // all (DATABASE_URL is already a direct connection there), so falling
  // back is safe. Never applies in production (guarded above).
  const pooled = env.DATABASE_URL;
  if (!pooled) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }
  return pooled;
}

/**
 * §28 - a Postgres SESSION-level advisory lock (not the DataPurgeJob-style
 * row + updateMany approach) is used here specifically because it does not
 * require a table at all and is automatically released if the process
 * crashes mid-job (the DB notices the connection dropped and frees the
 * lock) - no separate stale-lock-recovery logic is needed the way
 * ContractExtractionJob.lockedAt/lockedBy needs recover-stale-*.ts.
 *
 * A dedicated `pg.Client` is used (rather than Prisma's pooled connection)
 * because session-level advisory locks are tied to the exact connection
 * that acquired them - `pg_advisory_unlock` must run on that same
 * connection, which Prisma's connection pool cannot guarantee across two
 * separate `$queryRaw` calls. See resolveAdvisoryLockConnectionString()
 * above for why the connection string itself must also be non-pooled at
 * the network level. `hashtext(...)::bigint` maps an arbitrary-length key
 * string to the int8 `pg_try_advisory_lock` expects.
 */
export async function acquireAdvisoryLock(lockKey: string): Promise<AdvisoryLockHandle> {
  const client = new Client({ connectionString: resolveAdvisoryLockConnectionString() });
  await client.connect();

  const { rows } = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked",
    [lockKey]
  );
  const acquired = rows[0]?.locked === true;

  if (!acquired) {
    await client.end();
  }

  return {
    acquired,
    release: async () => {
      if (!acquired) {
        return;
      }
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]);
      } finally {
        await client.end();
      }
    },
  };
}
