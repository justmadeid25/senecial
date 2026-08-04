import { describe, expect, it } from "vitest";

import { validateProductionEnvironment } from "@/domain/production-readiness/validate-environment";

const BASE_PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  AUTH_SECRET: "a".repeat(40),
  APP_URL: "https://clausebase.example.com",
  AUTH_URL: "https://clausebase.example.com",
};

function findCheck(checks: ReturnType<typeof validateProductionEnvironment>, name: string) {
  const check = checks.find((c) => c.name === name);
  if (!check) {
    throw new Error(`check not found: ${name}`);
  }
  return check;
}

describe("validateProductionEnvironment (§36)", () => {
  it("passes every required check for a fully-configured production environment", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "NODE_ENV").status).toBe("pass");
    expect(findCheck(checks, "DATABASE_URL").status).toBe("pass");
    expect(findCheck(checks, "AUTH_SECRET").status).toBe("pass");
    expect(findCheck(checks, "APP_URL").status).toBe("pass");
    expect(findCheck(checks, "AUTH_URL").status).toBe("pass");
  });

  it("fails NODE_ENV when not production", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, NODE_ENV: "development" });
    expect(findCheck(checks, "NODE_ENV").status).toBe("fail");
  });

  it("fails a short AUTH_SECRET", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, AUTH_SECRET: "short" });
    expect(findCheck(checks, "AUTH_SECRET").status).toBe("fail");
  });

  it("fails a non-HTTPS APP_URL/AUTH_URL", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      APP_URL: "http://clausebase.example.com",
    });
    expect(findCheck(checks, "APP_URL").status).toBe("fail");
  });

  it("fails development invitation mailer without the allow flag", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "이메일 인증 mailer").status).toBe("fail");
  });

  it("warns (not fails) development invitation mailer with the allow flag explicitly set", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      ALLOW_DEVELOPMENT_INVITATION_MAILER: "true",
    });
    expect(findCheck(checks, "이메일 인증 mailer").status).toBe("warn");
  });

  it("passes a real (non-development) driver value outright", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      FILE_MALWARE_SCANNER: "clamav",
    });
    expect(findCheck(checks, "악성코드 스캐너").status).toBe("pass");
  });

  it("fails the noop malware scanner without the allow flag", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "악성코드 스캐너").status).toBe("fail");
  });

  it("fails development AI embedding/LLM providers and the in-memory AI cache without their allow flags (Phase 12 Part N)", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "AI 임베딩 provider").status).toBe("fail");
    expect(findCheck(checks, "AI LLM provider").status).toBe("fail");
    expect(findCheck(checks, "AI 캐시").status).toBe("fail");
  });

  it("warns (not fails) development AI providers/cache with their allow flags explicitly set", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      ALLOW_DEVELOPMENT_AI_PROVIDER: "true",
      ALLOW_IN_MEMORY_AI_CACHE: "true",
    });
    expect(findCheck(checks, "AI 임베딩 provider").status).toBe("warn");
    expect(findCheck(checks, "AI LLM provider").status).toBe("warn");
    expect(findCheck(checks, "AI 캐시").status).toBe("warn");
  });

  it("passes AI embedding/LLM providers and cache outright with real (non-development) driver values", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      AI_EMBEDDING_PROVIDER: "openai",
      AI_LLM_PROVIDER: "openai",
      AI_CACHE_PROVIDER: "redis",
    });
    expect(findCheck(checks, "AI 임베딩 provider").status).toBe("pass");
    expect(findCheck(checks, "AI LLM provider").status).toBe("pass");
    expect(findCheck(checks, "AI 캐시").status).toBe("pass");
  });

  it("fails the in-memory rate limiter without the allow flag", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "rate limiter").status).toBe("fail");
  });

  it("Phase 10A core completion condition: FILE_STORAGE_DRIVER=s3 and RATE_LIMITER=redis pass with no bypass flags", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      FILE_STORAGE_DRIVER: "s3",
      S3_REGION: "us-east-1",
      S3_BUCKET: "clausebase-prod-contracts",
      RATE_LIMITER: "redis",
      REDIS_URL: "redis://prod-redis:6379",
    });
    expect(findCheck(checks, "rate limiter").status).toBe("pass");
    expect(findCheck(checks, "S3_REGION / S3_BUCKET").status).toBe("pass");
    expect(findCheck(checks, "REDIS_URL").status).toBe("pass");
    // Only the storage/rate-limiter axis is asserted fail-free here - other
    // dev-only drivers (mailer, malware scanner, AI extraction/clause
    // providers) are legitimately still failing in BASE_PRODUCTION_ENV
    // since this test does not configure them; that is expected and out of
    // scope for this Phase (see the prompt's explicit exclusions).
    const storageAndRateLimitChecks = ["S3_REGION / S3_BUCKET", "S3 서버 측 암호화", "REDIS_URL", "rate limiter"];
    for (const name of storageAndRateLimitChecks) {
      expect(findCheck(checks, name).status).not.toBe("fail");
    }
  });

  it("fails S3_REGION / S3_BUCKET when FILE_STORAGE_DRIVER=s3 but the bucket is unset", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, FILE_STORAGE_DRIVER: "s3" });
    expect(findCheck(checks, "S3_REGION / S3_BUCKET").status).toBe("fail");
  });

  it("fails S3_REGION / S3_BUCKET when the bucket name is malformed", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      FILE_STORAGE_DRIVER: "s3",
      S3_REGION: "us-east-1",
      S3_BUCKET: "Not_A_Valid_Bucket_Name",
    });
    expect(findCheck(checks, "S3_REGION / S3_BUCKET").status).toBe("fail");
  });

  it("only warns (never fails/passes silently) on missing S3 server-side encryption", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      FILE_STORAGE_DRIVER: "s3",
      S3_REGION: "us-east-1",
      S3_BUCKET: "clausebase-prod-contracts",
    });
    expect(findCheck(checks, "S3 서버 측 암호화").status).toBe("warn");
  });

  it("fails REDIS_URL when RATE_LIMITER=redis but REDIS_URL is unset (driver-name guard alone is insufficient)", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, RATE_LIMITER: "redis" });
    expect(findCheck(checks, "REDIS_URL").status).toBe("fail");
  });

  it("does not add a REDIS_URL check at all when RATE_LIMITER is not redis", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(checks.find((c) => c.name === "REDIS_URL")).toBeUndefined();
  });

  it("Phase 10B core completion condition: INVITATION_MAILER=real and ACCOUNT_SECURITY_MAILER=real pass with no bypass flags", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      INVITATION_MAILER: "real",
      ACCOUNT_SECURITY_MAILER: "real",
      EMAIL_PROVIDER: "postmark",
      EMAIL_FROM_ADDRESS: "noreply@clausebase.example.com",
      POSTMARK_SERVER_TOKEN: "prod-token",
    });
    expect(findCheck(checks, "이메일 인증 mailer").status).toBe("pass");
    expect(findCheck(checks, "계정 보안 mailer(이메일 인증/비밀번호 재설정)").status).toBe("pass");
    expect(findCheck(checks, "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS").status).toBe("pass");
  });

  it("fails EMAIL_PROVIDER / EMAIL_FROM_ADDRESS when INVITATION_MAILER=real but EMAIL_FROM_ADDRESS is unset", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, INVITATION_MAILER: "real" });
    expect(findCheck(checks, "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS").status).toBe("fail");
  });

  it("fails EMAIL_PROVIDER / EMAIL_FROM_ADDRESS when provider=postmark but POSTMARK_SERVER_TOKEN is unset", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      ACCOUNT_SECURITY_MAILER: "real",
      EMAIL_PROVIDER: "postmark",
      EMAIL_FROM_ADDRESS: "noreply@clausebase.example.com",
    });
    expect(findCheck(checks, "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS").status).toBe("fail");
  });

  it("does not add an EMAIL_PROVIDER / EMAIL_FROM_ADDRESS check at all when both mailers stay on development", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(checks.find((c) => c.name === "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS")).toBeUndefined();
  });

  it("CORS check always passes (this app has no cross-origin API surface by design)", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "CORS").status).toBe("pass");
  });

  it("passes cookie/session consistency when APP_URL and AUTH_URL share the same host", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(findCheck(checks, "쿠키/세션(APP_URL vs AUTH_URL)").status).toBe("pass");
  });

  it("warns on cookie/session consistency when APP_URL and AUTH_URL have different hosts", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      AUTH_URL: "https://auth.clausebase.example.com",
    });
    expect(findCheck(checks, "쿠키/세션(APP_URL vs AUTH_URL)").status).toBe("warn");
  });

  it("does not add a Redis TLS check at all when RATE_LIMITER is not redis", () => {
    const checks = validateProductionEnvironment(BASE_PRODUCTION_ENV);
    expect(checks.find((c) => c.name === "Redis TLS")).toBeUndefined();
  });

  it("passes Redis TLS when REDIS_URL uses rediss://", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      RATE_LIMITER: "redis",
      REDIS_URL: "rediss://prod-redis:6380",
    });
    expect(findCheck(checks, "Redis TLS").status).toBe("pass");
  });

  it("warns (never fails) on Redis TLS when REDIS_URL uses plain redis://", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      RATE_LIMITER: "redis",
      REDIS_URL: "redis://prod-redis:6379",
    });
    expect(findCheck(checks, "Redis TLS").status).toBe("warn");
  });

  it("fails Redis TLS when RATE_LIMITER=redis but REDIS_URL is unset", () => {
    const checks = validateProductionEnvironment({ ...BASE_PRODUCTION_ENV, RATE_LIMITER: "redis" });
    expect(findCheck(checks, "Redis TLS").status).toBe("fail");
  });

  it("never includes the AUTH_SECRET or DATABASE_URL value itself in any check detail", () => {
    const checks = validateProductionEnvironment({
      ...BASE_PRODUCTION_ENV,
      AUTH_SECRET: "super-secret-value-that-must-never-appear-in-output",
    });
    const serialized = JSON.stringify(checks);
    expect(serialized).not.toContain("super-secret-value-that-must-never-appear-in-output");
    expect(serialized).not.toContain("user:pass@host");
  });
});
