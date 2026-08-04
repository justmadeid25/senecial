import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { recordDependencyLatency } from "@/server/monitoring/metrics";

declare global {
  var __prisma: PrismaClient<"query"> | undefined;
}

function createPrismaClient(): PrismaClient<"query"> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const adapter = new PrismaPg({ connectionString });

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
