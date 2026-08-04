import { computeConfigChecksum } from "@/domain/production-readiness/config-checksum";
import { validateProductionEnvironment } from "@/domain/production-readiness/validate-environment";
import { getLogger } from "@/server/logging";
import { recordStartupDuration } from "@/server/monitoring/metrics";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";

import { collectResourceDiagnostics } from "./resource-diagnostics";

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

  // §Phase 12.2 Part C (§21) - a SEPARATE checksum from the one above:
  // that one covers the whole production-readiness env checklist, this one
  // covers only AI-quality-relevant settings (AiRuntimeConfiguration) - the
  // two change independently and are logged independently. Never blocks
  // startup by itself (misconfigured AI_VECTOR_SEARCH_PROVIDER etc. is
  // caught by validateProductionEnvironment/checkReadiness instead) - this
  // is purely the "what config produced this process's answers" log line.
  try {
    const aiConfig = getAiRuntimeConfiguration();
    logger.info("startup.ai_config", { version: aiConfig.version, checksum: aiConfig.checksum });
  } catch (error) {
    logger.warn("startup.ai_config_unavailable", {
      detail: error instanceof Error ? error.message : "unknown error",
    });
  }

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

  // §Phase 12.3 Part B (§8) - process-level resource snapshot at startup,
  // safe to log unconditionally (see resource-diagnostics.ts's own
  // docstring - never a request/user/org identifier). Distinguishes "the
  // server never had a chance to warm up" from "it degraded under load" -
  // scripts/run-e2e-prod.ts also captures the tail of this process's
  // stdout on crash, which will include the LAST startup/request-time
  // diagnostic line logged before the crash if one was emitted.
  logger.info("startup.resource_diagnostics", collectResourceDiagnostics());

  if (process.env.NODE_ENV === "production" && failed.length > 0) {
    logger.error("startup.rejected", {
      reason: "production readiness check(s) failed - refusing to start serving traffic",
      failedChecks: failed.map((check) => check.name).join(", "),
    });
    process.exit(1);
  }
}
