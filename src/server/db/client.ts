import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { recordDependencyLatency } from "@/server/monitoring/metrics";

declare global {
  var __prisma: PrismaClient<"query"> | undefined;
}

/**
 * Phase 14 Part 3 (failure injection) - a real live Postgres-outage test
 * found this pool had NO connection timeout at all (pg's own default is
 * unbounded), so a query issued during an outage hung for ~10s (this
 * environment's TCP-level timeout) rather than failing fast - every
 * request touching the DB during an outage would hang that long instead
 * of returning a prompt error. Bounded, tunable via env (same pattern as
 * REDIS_CONNECT_TIMEOUT_MS) so a slower real network can raise it if 5s
 * ever proves too aggressive for a legitimate (non-outage) connection.
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const DATABASE_CONNECTION_TIMEOUT_MS = parsePositiveInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 5000);

function createPrismaClient(): PrismaClient<"query"> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS });

  const client = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
  // Phase 11 §Monitoring - a single choke point for every query this app
  // issues (raw or via the fluent API, inside or outside a
  // $transaction) - `e.duration` is the query's own execution time in ms
  // as Prisma's query engine reports it, never logged/exposed with the
  // query text itself (only the aggregate duration feeds the metric).
  client.$on("query", (e) => recordDependencyLatency("db", e.duration));

  return client;
}

function getPrismaClient(): PrismaClient<"query"> {
  if (!globalThis.__prisma) {
    globalThis.__prisma = createPrismaClient();
  }
  return globalThis.__prisma;
}

/**
 * Lazily constructs the real client on first use, not on import. Many
 * modules (e.g. src/lib/permissions/verify-membership.ts) export both
 * DB-backed and pure functions from the same file; importing the file for
 * just the pure function must not require DATABASE_URL to be set.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrismaClient(), prop, receiver);
  },
});
