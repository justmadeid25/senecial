import { Client } from "pg";

/**
 * A short-lived `pg` Client pointed at an arbitrary target database URL -
 * restore/verify scripts operate on a database that is (by design) not
 * necessarily DATABASE_URL, so they cannot reuse the app's own Prisma
 * client (server/db/client.ts is permanently bound to DATABASE_URL).
 */
export async function withTargetDatabaseClient<T>(
  targetDatabaseUrl: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: targetDatabaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
