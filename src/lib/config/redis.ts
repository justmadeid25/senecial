export interface RedisConfig {
  url: string;
  keyPrefix: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/**
 * §16 - reads Redis configuration from the environment. Like
 * `lib/config/s3.ts`'s `loadS3Config()`, this never throws for a missing
 * `REDIS_URL` - the driver factory calls `resolveRedisConfig()` (below)
 * for hard validation only once `RATE_LIMITER=redis` is actually
 * selected, so an environment that never uses Redis is never forced to
 * configure it.
 */
export function loadRedisConfig(env: NodeJS.ProcessEnv = process.env): Partial<RedisConfig> {
  return {
    url: env.REDIS_URL || undefined,
    keyPrefix: env.REDIS_KEY_PREFIX || "senecial",
    connectTimeoutMs: parsePositiveInt(env.REDIS_CONNECT_TIMEOUT_MS, 3000, "REDIS_CONNECT_TIMEOUT_MS"),
    commandTimeoutMs: parsePositiveInt(env.REDIS_COMMAND_TIMEOUT_MS, 2000, "REDIS_COMMAND_TIMEOUT_MS"),
  };
}

export function resolveRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  const config = loadRedisConfig(env);
  if (!config.url) {
    throw new Error("REDIS_URL이 설정되지 않았습니다.");
  }
  return config as RedisConfig;
}

export type RateLimitFailMode = "closed" | "open";

/**
 * §20 - every purpose currently rate-limited in this codebase (login,
 * signup, password reset, email verification, invitation, file upload,
 * CSV export, member role change) is a sensitive/write endpoint - this
 * app has deliberately never rate-limited file download or any other
 * read-only endpoint (see README's Phase 9 §16 note), so a single global
 * fail-mode is accurate for the current purpose set rather than an
 * under-used per-purpose override. Defaults to "closed" (the safe
 * default per §20) - "open" is an explicit, auditable opt-out.
 */
export function loadRateLimitFailMode(env: NodeJS.ProcessEnv = process.env): RateLimitFailMode {
  return env.RATE_LIMIT_FAIL_MODE === "open" ? "open" : "closed";
}
