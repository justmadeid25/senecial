import { describe, expect, it } from "vitest";

import { resolveAdvisoryLockConnectionString } from "@/server/batch/advisory-lock";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("resolveAdvisoryLockConnectionString (Neon/PgBouncer pooled-connection safety)", () => {
  it("prefers DATABASE_URL_UNPOOLED over DATABASE_URL when both are set", () => {
    const result = resolveAdvisoryLockConnectionString(
      env({
        DATABASE_URL: "postgresql://user:pass@pooled-host/db",
        DATABASE_URL_UNPOOLED: "postgresql://user:pass@direct-host/db",
      })
    );

    expect(result).toBe("postgresql://user:pass@direct-host/db");
  });

  it("throws in production when DATABASE_URL_UNPOOLED is missing, instead of silently falling back to pooled DATABASE_URL", () => {
    const target = env({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@pooled-host/db",
    });

    expect(() => resolveAdvisoryLockConnectionString(target)).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("does not fall back to pooled DATABASE_URL in production even when DATABASE_URL_UNPOOLED is an empty string", () => {
    const target = env({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@pooled-host/db",
      DATABASE_URL_UNPOOLED: "",
    });

    expect(() => resolveAdvisoryLockConnectionString(target)).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("falls back to DATABASE_URL in development when DATABASE_URL_UNPOOLED is unset (local Postgres has no pooler)", () => {
    const result = resolveAdvisoryLockConnectionString(
      env({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost/db",
      })
    );

    expect(result).toBe("postgresql://user:pass@localhost/db");
  });

  it("throws when neither variable is set in development", () => {
    const target = env({ NODE_ENV: "development" });

    expect(() => resolveAdvisoryLockConnectionString(target)).toThrow(/DATABASE_URL/);
  });
});
