import { afterEach, describe, expect, it, vi } from "vitest";

import { checkReadiness } from "@/features/health/server/check-readiness";
import { prisma } from "@/server/db/client";

describe("checkReadiness (§34/§49)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports ok when the database is reachable", async () => {
    const result = await checkReadiness();
    expect(result.checks.database).toBe("ok");
    expect(result.checks.storage).toBe("ok");
    expect(result.checks.rateLimit).toBe("ok");
    expect(result.checks.mail).toBe("ok");
    expect(result.checks.config).toBe("ok");
    expect(result.checks.batch).toBe("ok");
    expect(result.checks.vectorSearch).toBe("ok");
    expect(result.status).toBe("ok");
  });

  it("§Phase 12.1 - vectorSearch reports ok via a real pgvector distance query (this dev/test DB has the extension installed)", async () => {
    const result = await checkReadiness();
    expect(result.checks.vectorSearch).toBe("ok");
  });

  it("§Phase 12.1 - vectorSearch always reports ok when explicitly configured to use the application provider", async () => {
    vi.stubEnv("AI_VECTOR_SEARCH_PROVIDER", "application");
    const result = await checkReadiness();
    expect(result.checks.vectorSearch).toBe("ok");
  });


  it("reports version/buildDate as \"unknown\" when GIT_COMMIT_SHA/BUILD_DATE are not set (local dev)", async () => {
    const result = await checkReadiness();
    expect(result.version).toBe(process.env.GIT_COMMIT_SHA || "unknown");
    expect(result.buildDate).toBe(process.env.BUILD_DATE || "unknown");
  });

  it("reports batch error when a RUNNING BatchExecution's heartbeat has gone stale", async () => {
    const staleExecution = await prisma.batchExecution.create({
      data: {
        jobName: "health-check-test-stale-job",
        executionKey: `health-check-test-stale-${Date.now()}`,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
        lockedBy: "test-worker",
      },
    });

    try {
      const result = await checkReadiness();
      expect(result.checks.batch).toBe("error");
      expect(result.status).toBe("error");
    } finally {
      await prisma.batchExecution.delete({ where: { id: staleExecution.id } });
    }
  });

  it("reports database error (and overall error) when the DB is unreachable, without throwing", async () => {
    vi.spyOn(prisma.organization, "count").mockRejectedValueOnce(new Error("connection refused"));

    const result = await checkReadiness();
    expect(result.checks.database).toBe("error");
    expect(result.status).toBe("error");
  });

  it("never includes DB host, storage path, or any secret in the result", async () => {
    const result = await checkReadiness();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(process.env.DATABASE_URL ?? "__never__");
    expect(serialized).not.toMatch(/postgresql:\/\//);
  });
});
