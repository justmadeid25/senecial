import { Client } from "pg";

export interface AdvisoryLockHandle {
  acquired: boolean;
  release(): Promise<void>;
}

/**
 * §28 - a Postgres SESSION-level advisory lock (not the DataPurgeJob-style
 * row + updateMany approach) is used here specifically because it does not
 * require a table at all and is automatically released if the process
 * crashes mid-job (the DB notices the connection dropped and frees the
 * lock) - no separate stale-lock-recovery logic is needed the way
 * ContractExtractionJob.lockedAt/lockedBy needs recover-stale-*.ts.
 *
 * A dedicated, non-pooled `pg.Client` is used (rather than Prisma's
 * pooled connection) because session-level advisory locks are tied to the
 * exact connection that acquired them - `pg_advisory_unlock` must run on
 * that same connection, which Prisma's connection pool cannot guarantee
 * across two separate `$queryRaw` calls. `hashtext(...)::bigint` maps an
 * arbitrary-length key string to the int8 `pg_try_advisory_lock` expects.
 */
export async function acquireAdvisoryLock(lockKey: string): Promise<AdvisoryLockHandle> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
