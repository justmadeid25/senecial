import { resolveRedisConfig } from "@/lib/config/redis";

import { getRedisClient } from "./redis-client";

export type RateLimiterReadinessStatus = "ok" | "error";

/**
 * §22 - `RATE_LIMITER=memory` is trivially always "ok": it is in-process,
 * there is nothing external to reach. `RATE_LIMITER=redis` issues a real
 * `PING` against the shared singleton client - proving the connection is
 * actually alive right now, not just that `REDIS_URL` parses. Never
 * returns or logs the Redis host/port/DB number/prefix - status only, per
 * §22's public-response requirement (`{"rateLimit": "ok"}`).
 */
export async function checkRateLimiterReadiness(): Promise<RateLimiterReadinessStatus> {
  const driver = process.env.RATE_LIMITER ?? "memory";

  if (driver !== "redis") {
    return "ok";
  }

  try {
    const config = resolveRedisConfig();
    const client = getRedisClient(config);
    const reply = await client.ping();
    return reply === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
