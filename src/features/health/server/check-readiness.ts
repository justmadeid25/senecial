import { mkdir } from "node:fs/promises";

import { STALE_BATCH_HEARTBEAT_MINUTES } from "@/domain/batch/batch-heartbeat-timing";
import { getVersionInfo } from "@/domain/production-readiness/version-info";
import { loadEmailConfig, validateEmailConfig } from "@/lib/config/email";
import { resolveS3Config } from "@/lib/config/s3";
import { prisma } from "@/server/db/client";
import { createS3Client } from "@/server/storage/s3-client";
import { probeS3BucketAccess } from "@/server/storage/s3-bucket-probe";
import { checkRateLimiterReadiness } from "@/server/services/rate-limit/check-rate-limiter-readiness";

export type HealthCheckStatus = "ok" | "error";

export interface ReadinessResult {
  status: HealthCheckStatus;
  checks: {
    database: HealthCheckStatus;
    storage: HealthCheckStatus;
    rateLimit: HealthCheckStatus;
    mail: HealthCheckStatus;
    config: HealthCheckStatus;
    batch: HealthCheckStatus;
    vectorSearch: HealthCheckStatus;
  };
  version: string;
  buildDate: string;
}

/**
 * §34 - never includes DB host, storage path, bucket name, Redis host, or
 * any secret in the result - status strings only. `database` also
 * implicitly confirms migrations have been applied (a query against a
 * real table fails if the schema is out of date), not just that the
 * connection itself is alive. `version`/`buildDate` are the one
 * intentional exception to "no build identity in a public response" -
 * §Version explicitly asks for them, and a git commit SHA/build date are
 * not secrets (this is exactly the same information visible in any
 * public GitHub commit).
 */
export async function checkReadiness(): Promise<ReadinessResult> {
  const [database, storage, rateLimit, mail, config, batch, vectorSearch] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkRateLimiterReadiness(),
    checkMail(),
    checkConfig(),
    checkBatch(),
    checkVectorSearch(),
  ]);

  const status: HealthCheckStatus =
    database === "ok" &&
    storage === "ok" &&
    rateLimit === "ok" &&
    mail === "ok" &&
    config === "ok" &&
    batch === "ok" &&
    vectorSearch === "ok"
      ? "ok"
      : "error";

  const { gitCommitSha, buildDate } = getVersionInfo();

  return {
    status,
    checks: { database, storage, rateLimit, mail, config, batch, vectorSearch },
    version: gitCommitSha,
    buildDate,
  };
}

/**
 * §Phase 12.1 Part 13/§20 - the decision logic split out from the actual DB
 * probe below so it is unit-testable without mocking Prisma's raw-query
 * method (which vitest's `vi.spyOn` cannot intercept the same way it does
 * a normal model delegate method like `prisma.organization.count`).
 * `AI_VECTOR_SEARCH_PROVIDER=application` (an explicit, deliberate opt-out
 * of the DB-native path) always reports "ok" - there is nothing
 * pgvector-specific to verify in that configuration. A probe failure is
 * only reported "ok" anyway if `AI_VECTOR_SEARCH_ALLOW_FALLBACK=true` is
 * explicitly set (§12's fallback policy) - reflecting that the app itself
 * would gracefully degrade rather than fail requests in that
 * configuration.
 */
export function resolveVectorSearchReadinessStatus(params: {
  driver: string;
  probeSucceeded: boolean;
  allowFallback: boolean;
}): HealthCheckStatus {
  if (params.driver !== "pgvector") {
    return "ok";
  }
  if (params.probeSucceeded) {
    return "ok";
  }
  return params.allowFallback ? "ok" : "error";
}

/**
 * §Phase 12.1 Part 13 - public, minimal-information (per §34's own rule
 * this file already follows for every other check): "ok"/"error" only,
 * never the extension version, row counts, or table/column names - see
 * probe-vector-search-details.ts for the detailed, OPERATOR-ONLY version
 * scripts/validate-production-readiness.ts prints instead. When the
 * provider is `pgvector` (the default), this actually exercises a real
 * `<=>` distance query - not just "does the extension row exist" - so a
 * broken/half-installed extension is caught the same way a broken DB
 * connection is caught by `checkDatabase()` above.
 */
async function checkVectorSearch(): Promise<HealthCheckStatus> {
  const driver = process.env.AI_VECTOR_SEARCH_PROVIDER ?? "pgvector";
  let probeSucceeded = false;

  if (driver === "pgvector") {
    try {
      await prisma.$queryRaw`SELECT '[1,0,0]'::vector(3) <=> '[1,0,0]'::vector(3)`;
      probeSucceeded = true;
    } catch {
      probeSucceeded = false;
    }
  }

  return resolveVectorSearchReadinessStatus({
    driver,
    probeSucceeded,
    allowFallback: process.env.AI_VECTOR_SEARCH_ALLOW_FALLBACK === "true",
  });
}

/**
 * Phase 11 Part H - "batch" health: are scheduled batch jobs actually
 * still alive, not just "is the batch_executions table queryable". A
 * RUNNING row whose heartbeat is older than the stale threshold means its
 * worker process very likely died mid-job (see run-batch-job.ts's
 * heartbeat() callback) - the same signal recover-stale-*.ts scripts act
 * on, surfaced here so an orchestrator/on-call dashboard sees it without
 * having to query the table by hand.
 */
async function checkBatch(): Promise<HealthCheckStatus> {
  try {
    const staleBefore = new Date(Date.now() - STALE_BATCH_HEARTBEAT_MINUTES * 60 * 1000);
    const staleCount = await prisma.batchExecution.count({
      where: { status: "RUNNING", heartbeatAt: { lt: staleBefore } },
    });
    return staleCount === 0 ? "ok" : "error";
  } catch {
    return "error";
  }
}

async function checkDatabase(): Promise<HealthCheckStatus> {
  try {
    await prisma.organization.count();
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * Phase 10A §11 - driver-aware. Local: `mkdir(recursive: true)` (succeeds
 * whether or not the directory already exists, unlike `access()`, which
 * would falsely report "not ready" on a fresh deployment before any
 * upload has ever happened - and confirms real write permission). S3: a
 * single cheap `HeadBucket` call (`probeS3BucketAccess`) - never a
 * put/get/delete round-trip on every request, see that function's
 * docstring for why.
 */
async function checkStorage(): Promise<HealthCheckStatus> {
  const driver = process.env.FILE_STORAGE_DRIVER ?? "local";

  if (driver === "s3") {
    try {
      const config = resolveS3Config();
      const client = createS3Client(config);
      const result = await probeS3BucketAccess(client, config);
      return result.status;
    } catch {
      return "error";
    }
  }

  try {
    await mkdir(process.env.LOCAL_STORAGE_PATH ?? "./storage", { recursive: true });
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * Phase 10B §23 - deliberately config-validity only, NEVER a live call to
 * the mail provider's API - unlike storage/rateLimit, mail sending is not
 * something this app cannot function without on a per-request basis, so a
 * public endpoint that orchestrators may poll every few seconds must not
 * carry a recurring external dependency on the mail provider just to
 * answer "is this app up". Live provider connectivity is checked instead
 * by `pnpm mail:diagnose` / `pnpm production:validate` (operator-invoked
 * only - see scripts/diagnose-mail-provider.ts).
 */
async function checkMail(): Promise<HealthCheckStatus> {
  const invitationDriver = process.env.INVITATION_MAILER ?? "development";
  const accountSecurityDriver = process.env.ACCOUNT_SECURITY_MAILER ?? "development";

  if (invitationDriver !== "real" && accountSecurityDriver !== "real") {
    return "ok";
  }

  const config = loadEmailConfig();
  return validateEmailConfig(config).valid ? "ok" : "error";
}

async function checkConfig(): Promise<HealthCheckStatus> {
  return process.env.DATABASE_URL && process.env.AUTH_SECRET ? "ok" : "error";
}
