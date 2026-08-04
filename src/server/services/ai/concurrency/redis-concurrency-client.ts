import Redis, { type Redis as RedisClient } from "ioredis";

import type { RedisConfig } from "@/lib/config/redis";
import { getLogger } from "@/server/logging";

import { ACQUIRE_CONCURRENCY_SLOT_SCRIPT, RELEASE_CONCURRENCY_SLOT_SCRIPT } from "./redis-concurrency-lua-scripts";

export interface RedisWithConcurrencyCommands extends RedisClient {
  acquireConcurrencySlot(key: string, maxConcurrent: number, leaseSeconds: number): Promise<[number, number]>;
  releaseConcurrencySlot(key: string): Promise<number>;
}

declare global {
  var __clausebaseRedisAiConcurrencyClient: RedisWithConcurrencyCommands | undefined;
}

/**
 * §Phase 12.2 Part E (§33) - its own dedicated ioredis connection/key
 * namespace, same rationale as the rate limiter's and the AI cache's own
 * dedicated clients (server/services/rate-limit/redis-client.ts,
 * server/services/ai/cache/redis-client.ts): a distinct subsystem, never
 * sharing another subsystem's connection or Lua command registrations.
 * Stashed on `globalThis` to survive Next.js dev-mode HMR without leaking
 * a new TCP connection on every edit (see the rate-limit client's own
 * docstring for the full explanation).
 */
export function getAiConcurrencyRedisClient(config: RedisConfig): RedisWithConcurrencyCommands {
  if (globalThis.__clausebaseRedisAiConcurrencyClient) {
    return globalThis.__clausebaseRedisAiConcurrencyClient;
  }

  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    keyPrefix: `${config.keyPrefix}:ai-concurrency:`,
    lazyConnect: false,
  }) as RedisWithConcurrencyCommands;

  client.defineCommand("acquireConcurrencySlot", { numberOfKeys: 1, lua: ACQUIRE_CONCURRENCY_SLOT_SCRIPT });
  client.defineCommand("releaseConcurrencySlot", { numberOfKeys: 1, lua: RELEASE_CONCURRENCY_SLOT_SCRIPT });

  client.on("error", (error: Error) => {
    getLogger().error("redis.connection_error", { errorCode: error.name, subsystem: "ai-concurrency" });
  });

  globalThis.__clausebaseRedisAiConcurrencyClient = client;
  return client;
}

export async function closeAiConcurrencyRedisClient(): Promise<void> {
  if (globalThis.__clausebaseRedisAiConcurrencyClient) {
    await globalThis.__clausebaseRedisAiConcurrencyClient.quit().catch(() => undefined);
    globalThis.__clausebaseRedisAiConcurrencyClient = undefined;
  }
}
