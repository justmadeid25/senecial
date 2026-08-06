import Redis, { type Redis as RedisClient } from "ioredis";

import type { RedisConfig } from "@/lib/config/redis";
import { getLogger } from "@/server/logging";

import {
  CIRCUIT_BEFORE_CALL_SCRIPT,
  CIRCUIT_ON_FAILURE_SCRIPT,
  CIRCUIT_ON_SUCCESS_SCRIPT,
} from "./redis-circuit-breaker-lua-scripts";

export interface RedisWithCircuitBreakerCommands extends RedisClient {
  circuitBeforeCall(key: string, now: number, openDurationMs: number, probeTimeoutMs: number): Promise<[number, string]>;
  circuitOnSuccess(key: string): Promise<number>;
  circuitOnFailure(
    key: string,
    now: number,
    failureThreshold: number,
    failureWindowSeconds: number,
    openDurationSeconds: number
  ): Promise<[number, string]>;
}

declare global {
  var __senecialRedisAiCircuitBreakerClient: RedisWithCircuitBreakerCommands | undefined;
}

/**
 * §Phase 13 Part E (§17) - its own dedicated ioredis connection/key
 * namespace, same rationale as every other AI subsystem's own client
 * (rate-limit, ai-cache, ai-concurrency): a distinct subsystem never
 * shares another's connection or Lua command registrations. Stashed on
 * `globalThis` to survive Next.js dev-mode HMR without leaking a new TCP
 * connection on every edit.
 */
export function getAiCircuitBreakerRedisClient(config: RedisConfig): RedisWithCircuitBreakerCommands {
  if (globalThis.__senecialRedisAiCircuitBreakerClient) {
    return globalThis.__senecialRedisAiCircuitBreakerClient;
  }

  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    keyPrefix: `${config.keyPrefix}:ai-circuit-breaker:`,
    lazyConnect: false,
  }) as RedisWithCircuitBreakerCommands;

  client.defineCommand("circuitBeforeCall", { numberOfKeys: 1, lua: CIRCUIT_BEFORE_CALL_SCRIPT });
  client.defineCommand("circuitOnSuccess", { numberOfKeys: 1, lua: CIRCUIT_ON_SUCCESS_SCRIPT });
  client.defineCommand("circuitOnFailure", { numberOfKeys: 1, lua: CIRCUIT_ON_FAILURE_SCRIPT });

  client.on("error", (error: Error) => {
    getLogger().error("redis.connection_error", { errorCode: error.name, subsystem: "ai-circuit-breaker" });
  });

  globalThis.__senecialRedisAiCircuitBreakerClient = client;
  return client;
}

export async function closeAiCircuitBreakerRedisClient(): Promise<void> {
  if (globalThis.__senecialRedisAiCircuitBreakerClient) {
    await globalThis.__senecialRedisAiCircuitBreakerClient.quit().catch(() => undefined);
    globalThis.__senecialRedisAiCircuitBreakerClient = undefined;
  }
}
