import { computeConfigChecksum } from "@/domain/production-readiness/config-checksum";
import { validateProductionEnvironment } from "@/domain/production-readiness/validate-environment";
import { getLogger } from "@/server/logging";
import { recordStartupDuration } from "@/server/monitoring/metrics";

const startedAt = Date.now();

/**
 * Phase 11 Part B/I - runs once per server process, from instrumentation.ts's
 * `register()` (Next.js awaits this before serving any request - see
 * https://nextjs.org/docs/app/guides/instrumentation). Outside production
 * this only logs (development/test must never be blocked by production-only
 * guards - same philosophy as every other `ALLOW_*` gate in this codebase).
 * In production, ANY `fail`-status check rejects startup outright
 * (`process.exit(1)`) - a misconfigured production deployment must never
 * start serving traffic only to fail on its first real request.
 *
 * Also logs a non-secret config checksum (§Config checksum) - two
 * instances of the same deployment should log the identical checksum;
 * a mismatch is visible in log aggregation without ever diffing raw env
 * files against each other.
 */
export async function runStartupChecks(): Promise<void> {
  const logger = getLogger();
  const checks = validateProductionEnvironment(process.env);
  const { checksum, keyCount } = computeConfigChecksum(process.env);

  logger.info("startup.config_checksum", { checksum, keyCount });

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");

  for (const check of failed) {
    logger.error("startup.check_failed", { name: check.name, detail: check.detail });
  }
  for (const check of warned) {
    logger.warn("startup.check_warned", { name: check.name, detail: check.detail });
  }

  const durationMs = Date.now() - startedAt;
  recordStartupDuration(durationMs);
  logger.info("startup.completed", {
    durationMs,
    checksTotal: checks.length,
    failedCount: failed.length,
    warnedCount: warned.length,
    nodeEnv: process.env.NODE_ENV ?? "(unset)",
  });

  if (process.env.NODE_ENV === "production" && failed.length > 0) {
    logger.error("startup.rejected", {
      reason: "production readiness check(s) failed - refusing to start serving traffic",
      failedChecks: failed.map((check) => check.name).join(", "),
    });
    process.exit(1);
  }
}
