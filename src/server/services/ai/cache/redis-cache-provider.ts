import type { Redis } from "ioredis";

import type { CacheProvider } from "./cache-provider";

/**
 * §Cache (Phase 12 Part N) - real shared-storage-backed cache for a
 * multi-instance production deployment, using the same ioredis client
 * shape as the rate limiter's own Redis driver (see
 * server/services/rate-limit/redis-client.ts) but its own dedicated
 * connection (see redis-client.ts in this directory) - a distinct
 * subsystem with its own key namespace, not sharing the rate limiter's
 * custom Lua-script client.
 */
export class RedisCacheProvider implements CacheProvider {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | undefined> {
    const value = await this.client.get(key);
    return value ?? undefined;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }
}
