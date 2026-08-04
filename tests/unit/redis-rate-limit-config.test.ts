import { describe, expect, it } from "vitest";

import { loadRateLimitFailMode, loadRedisConfig, resolveRedisConfig } from "@/lib/config/redis";
import { CONSUME_RATE_LIMIT_SCRIPT } from "@/server/services/rate-limit/redis-lua-scripts";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("loadRedisConfig / resolveRedisConfig (§16)", () => {
  it("loadRedisConfig never throws for a completely empty environment", () => {
    const config = loadRedisConfig(env({}));
    expect(config.url).toBeUndefined();
    expect(config.keyPrefix).toBe("senecial");
    expect(config.connectTimeoutMs).toBe(3000);
    expect(config.commandTimeoutMs).toBe(2000);
  });

  it("applies REDIS_KEY_PREFIX/timeouts from the environment", () => {
    const config = loadRedisConfig(
      env({
        REDIS_URL: "redis://localhost:6379",
        REDIS_KEY_PREFIX: "myapp",
        REDIS_CONNECT_TIMEOUT_MS: "5000",
        REDIS_COMMAND_TIMEOUT_MS: "1000",
      })
    );
    expect(config.url).toBe("redis://localhost:6379");
    expect(config.keyPrefix).toBe("myapp");
    expect(config.connectTimeoutMs).toBe(5000);
    expect(config.commandTimeoutMs).toBe(1000);
  });

  it("falls back to the default on a non-numeric timeout rather than throwing", () => {
    const config = loadRedisConfig(env({ REDIS_CONNECT_TIMEOUT_MS: "not-a-number" }));
    expect(config.connectTimeoutMs).toBe(3000);
  });

  it("resolveRedisConfig throws when REDIS_URL is unset", () => {
    expect(() => resolveRedisConfig(env({}))).toThrow(/REDIS_URL/);
  });

  it("resolveRedisConfig returns a fully-typed config when REDIS_URL is set", () => {
    const config = resolveRedisConfig(env({ REDIS_URL: "redis://localhost:6379" }));
    expect(config.url).toBe("redis://localhost:6379");
  });
});

describe("loadRateLimitFailMode (§20)", () => {
  it("defaults to closed", () => {
    expect(loadRateLimitFailMode(env({}))).toBe("closed");
  });

  it("defaults to closed on any value other than exactly 'open'", () => {
    expect(loadRateLimitFailMode(env({ RATE_LIMIT_FAIL_MODE: "OPEN" }))).toBe("closed");
    expect(loadRateLimitFailMode(env({ RATE_LIMIT_FAIL_MODE: "true" }))).toBe("closed");
  });

  it("only flips to open on an explicit exact match", () => {
    expect(loadRateLimitFailMode(env({ RATE_LIMIT_FAIL_MODE: "open" }))).toBe("open");
  });
});

describe("CONSUME_RATE_LIMIT_SCRIPT (§17 - atomic fixed-window consume)", () => {
  it("never issues a separate GET before INCR (the race condition the script exists to avoid)", () => {
    expect(CONSUME_RATE_LIMIT_SCRIPT).not.toMatch(/redis\.call\(['"]GET['"]/i);
  });

  it("uses INCR + PEXPIRE only on the first hit, not on every call", () => {
    expect(CONSUME_RATE_LIMIT_SCRIPT).toMatch(/redis\.call\(['"]INCR['"]/i);
    expect(CONSUME_RATE_LIMIT_SCRIPT).toMatch(/current == 1/);
  });

  it("references exactly one KEYS entry and two ARGV entries (limit, windowSeconds)", () => {
    expect(CONSUME_RATE_LIMIT_SCRIPT).toContain("KEYS[1]");
    expect(CONSUME_RATE_LIMIT_SCRIPT).toContain("ARGV[1]");
    expect(CONSUME_RATE_LIMIT_SCRIPT).toContain("ARGV[2]");
    expect(CONSUME_RATE_LIMIT_SCRIPT).not.toContain("KEYS[2]");
  });
});
