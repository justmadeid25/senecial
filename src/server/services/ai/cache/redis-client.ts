import Redis, { type Redis as RedisClient } from "ioredis";

import type { RedisConfig } from "@/lib/config/redis";
import { getLogger } from "@/server/logging";

declare global {
  var __clausebaseAiCacheRedisClient: RedisClient | undefined;
}

/**
 * A separate connection/global from server/services/rate-limit's own
 * Redis client - different subsystem, different key namespace
 * (`keyPrefix` below is still `${config.keyPrefix}:ai-cache:`, so even
 * pointed at the same Redis instance as the rate limiter, keys never
 * collide). Stashed on `globalThis` for the same HMR-survival reason as
 * every other module-level singleton in this codebase (see
 * server/db/client.ts, server/services/rate-limit/redis-client.ts).
 */
export function getAiCacheRedisClient(config: RedisConfig): RedisClient {
  if (globalThis.__clausebaseAiCacheRedisClient) {
    return globalThis.__clausebaseAiCacheRedisClient;
  }

  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    keyPrefix: `${config.keyPrefix}:ai-cache:`,
    lazyConnect: false,
  });

  client.on("error", (error: Error) => {
    getLogger().error("ai_cache.redis_connection_error", { errorCode: error.name });
  });

  globalThis.__clausebaseAiCacheRedisClient = client;
  return client;
}

export async function closeAiCacheRedisClient(): Promise<void> {
  if (globalThis.__clausebaseAiCacheRedisClient) {
    await globalThis.__clausebaseAiCacheRedisClient.quit().catch(() => undefined);
    globalThis.__clausebaseAiCacheRedisClient = undefined;
  }
}
