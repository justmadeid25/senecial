import Redis, { type Redis as RedisClient } from "ioredis";

import type { RedisConfig } from "@/lib/config/redis";
import { getLogger } from "@/server/logging";

import { CONSUME_RATE_LIMIT_SCRIPT } from "./redis-lua-scripts";

/** The `consumeRateLimit` command registered via `defineCommand` below - ioredis does not type custom commands automatically. */
export interface RedisWithRateLimitCommands extends RedisClient {
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<[number, number, number]>;
}

declare global {
  var __senecialRedisRateLimitClient: RedisWithRateLimitCommands | undefined;
}

/**
 * §21 - a single, module-level singleton reused across every `consume()`
 * call, exactly like `server/db/client.ts`'s Prisma singleton and for the
 * identical reason: Next.js dev-mode hot module reloading re-executes
 * this module's top level on every edit, and without stashing the
 * instance on `globalThis` (which survives HMR, unlike a plain module-level
 * `let`) each reload would open a brand new TCP connection to Redis while
 * the previous one leaks, forever, until the dev server restarts.
 *
 * `maxRetriesPerRequest: 1` - fail a single in-flight command fast (one
 * retry) rather than ioredis's default of unboundedly queuing/retrying
 * commands while disconnected. §20's fail-closed policy depends on
 * `consume()` actually throwing promptly during an outage instead of
 * hanging - a rate limiter that "fails" by hanging for 30+ seconds is
 * worse than one that fails fast and lets the caller apply its own
 * fail-open/closed decision immediately.
 *
 * `retryStrategy` - reconnect backoff, capped at 5s between attempts, so
 * a prolonged Redis outage does not hammer it with reconnect attempts nor
 * give up permanently (ioredis keeps calling this on every disconnect
 * until `disconnect()`/`quit()` is called).
 */
export function getRedisClient(config: RedisConfig): RedisWithRateLimitCommands {
  if (globalThis.__senecialRedisRateLimitClient) {
    return globalThis.__senecialRedisRateLimitClient;
  }

  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    keyPrefix: `${config.keyPrefix}:`,
    lazyConnect: false,
  }) as RedisWithRateLimitCommands;

  client.defineCommand("consumeRateLimit", { numberOfKeys: 1, lua: CONSUME_RATE_LIMIT_SCRIPT });

  // Never logs the connection URL (which embeds credentials) - only a
  // safe, generic event name and the error's own short code/name.
  client.on("error", (error: Error) => {
    getLogger().error("redis.connection_error", { errorCode: error.name });
  });

  globalThis.__senecialRedisRateLimitClient = client;
  return client;
}

/** §21 - graceful close for app shutdown (tests' afterAll, a process SIGTERM handler, ...). Safe to call even if no client was ever created. */
export async function closeRedisClient(): Promise<void> {
  if (globalThis.__senecialRedisRateLimitClient) {
    await globalThis.__senecialRedisRateLimitClient.quit().catch(() => undefined);
    globalThis.__senecialRedisRateLimitClient = undefined;
  }
}
