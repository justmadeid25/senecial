import Redis, { type Redis as RedisClient } from "ioredis";

import type { RedisConfig } from "@/lib/config/redis";
import { getLogger } from "@/server/logging";

import { BUDGET_ADJUST_SCRIPT, BUDGET_RELEASE_SCRIPT, BUDGET_RESERVE_SCRIPT } from "./redis-budget-lua-scripts";

export interface RedisWithBudgetCommands extends RedisClient {
  budgetReserve(key: string, amount: number, limit: number, ttlSeconds: number): Promise<[number, number]>;
  budgetAdjust(key: string, deltaAmount: number): Promise<number>;
  budgetRelease(key: string, amount: number): Promise<number>;
}

declare global {
  var __senecialRedisAiBudgetClient: RedisWithBudgetCommands | undefined;
}

/** §Phase 13 Part G (§27) - its own dedicated ioredis connection/key namespace, same rationale as every other AI subsystem's own client. */
export function getAiBudgetRedisClient(config: RedisConfig): RedisWithBudgetCommands {
  if (globalThis.__senecialRedisAiBudgetClient) {
    return globalThis.__senecialRedisAiBudgetClient;
  }

  const client = new Redis(config.url, {
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    keyPrefix: `${config.keyPrefix}:ai-budget:`,
    lazyConnect: false,
  }) as RedisWithBudgetCommands;

  client.defineCommand("budgetReserve", { numberOfKeys: 1, lua: BUDGET_RESERVE_SCRIPT });
  client.defineCommand("budgetAdjust", { numberOfKeys: 1, lua: BUDGET_ADJUST_SCRIPT });
  client.defineCommand("budgetRelease", { numberOfKeys: 1, lua: BUDGET_RELEASE_SCRIPT });

  client.on("error", (error: Error) => {
    getLogger().error("redis.connection_error", { errorCode: error.name, subsystem: "ai-budget" });
  });

  globalThis.__senecialRedisAiBudgetClient = client;
  return client;
}

export async function closeAiBudgetRedisClient(): Promise<void> {
  if (globalThis.__senecialRedisAiBudgetClient) {
    await globalThis.__senecialRedisAiBudgetClient.quit().catch(() => undefined);
    globalThis.__senecialRedisAiBudgetClient = undefined;
  }
}
