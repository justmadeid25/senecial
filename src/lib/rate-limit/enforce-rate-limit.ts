import { RATE_LIMIT_BUDGETS, type RateLimitPurpose } from "@/lib/config/rate-limit";
import { loadRateLimitFailMode } from "@/lib/config/redis";
import { RateLimitError } from "@/lib/errors";
import { getClientIpPrefix } from "@/lib/http/client-ip";
import { buildRateLimitKey } from "@/domain/rate-limit/rate-limit-key";
import { getLogger } from "@/server/logging";
import { getRateLimiter } from "@/server/services/rate-limit";

const RATE_LIMITER_UNAVAILABLE_RETRY_SECONDS = 30;

/**
 * §20 - RedisRateLimiter.consume() deliberately lets connection/timeout
 * errors propagate as-is (see its own docstring) rather than interpreting
 * them itself, precisely so this ONE call site can apply
 * RATE_LIMIT_FAIL_MODE consistently for every purpose. Before this, that
 * env var was parsed but never actually read anywhere - every caller's
 * `catch (e) { if (e instanceof RateLimitError) {...}; throw e; }` pattern
 * (see login-action.ts and friends) re-threw the raw Redis error as an
 * unhandled exception regardless of the configured mode, which happened to
 * still block the request (a crash blocks too) but never in a controlled,
 * user-facing way, and "open" had zero effect even when explicitly set.
 *
 * "closed" (default): re-thrown as a RateLimitError, so every existing
 * `instanceof RateLimitError` catch block already handles this exactly
 * like an exhausted budget - no other call site needs to change.
 * "open": logged and treated as allowed - an explicit, audited opt-out for
 * an active Redis incident, never the default.
 */
function handleRateLimiterUnavailable(error: unknown): void {
  const failMode = loadRateLimitFailMode();
  if (failMode === "open") {
    getLogger().error("rate_limit.unavailable_failing_open", {
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    return;
  }
  getLogger().error("rate_limit.unavailable_failing_closed", {
    errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
  });
  throw new RateLimitError(new Date(Date.now() + RATE_LIMITER_UNAVAILABLE_RETRY_SECONDS * 1000), {
    message: "일시적으로 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  });
}

/**
 * Consumes one unit of the named purpose's budget for the current
 * request's (identifier, client IP prefix) pair and throws RateLimitError
 * if it is exhausted. Server Action callers should catch RateLimitError
 * and return their normal `{success: false, message}` result shape (§17 -
 * never let it bubble as an unhandled exception into a generic 500); Route
 * Handlers should let it propagate to their top-level catch and pass it
 * through lib/http/error-response.ts's errorResponse(), which responds 429
 * with a Retry-After header.
 */
export async function enforceRateLimit(purpose: RateLimitPurpose, identifier: string): Promise<void> {
  const budget = RATE_LIMIT_BUDGETS[purpose];
  const ipPrefix = await getClientIpPrefix();
  const key = buildRateLimitKey(purpose, identifier, ipPrefix);

  let result;
  try {
    result = await getRateLimiter().consume({
      key,
      limit: budget.limit,
      windowSeconds: budget.windowSeconds,
    });
  } catch (error) {
    handleRateLimiterUnavailable(error);
    return;
  }

  if (!result.allowed) {
    throw new RateLimitError(result.resetAt, { limit: budget.limit, remaining: result.remaining });
  }
}

/**
 * Phase 10A §19 - login-specific multi-axis enforcement. Consumes THREE
 * independent budgets for every call - identifier-only, IP-prefix-only,
 * and the original combined (identifier, IP) axis - so that neither
 * rotating the email against one IP (password spraying) nor rotating the
 * IP against one email (distributed credential stuffing) alone stays
 * under any single budget. All three are always consumed (never
 * short-circuited) so each axis's count accurately reflects every failed
 * attempt regardless of which other axis blocks first; the caller is
 * blocked if ANY axis is exhausted, using the latest `resetAt` among the
 * exhausted axes so a retry is never invited before every blocking budget
 * has actually cleared.
 *
 * Same call-site contract as `enforceRateLimit()`: the caller (login-action.ts)
 * only invokes this on a FAILED credential check, never on success, so a
 * successful login never consumes - and therefore never resets or drains -
 * any of these three budgets either.
 */
export async function enforceLoginRateLimit(email: string): Promise<void> {
  const ipPrefix = await getClientIpPrefix();
  const limiter = getRateLimiter();

  const axes = [
    { key: buildRateLimitKey("login:identifier", email, "-"), budget: RATE_LIMIT_BUDGETS.loginByIdentifier },
    { key: buildRateLimitKey("login:ip", ipPrefix, "-"), budget: RATE_LIMIT_BUDGETS.loginByIp },
    { key: buildRateLimitKey("login", email, ipPrefix), budget: RATE_LIMIT_BUDGETS.login },
  ];

  let results;
  try {
    results = await Promise.all(
      axes.map((axis) => limiter.consume({ key: axis.key, limit: axis.budget.limit, windowSeconds: axis.budget.windowSeconds }))
    );
  } catch (error) {
    handleRateLimiterUnavailable(error);
    return;
  }

  const blocked = results.map((result, i) => ({ result, budget: axes[i]!.budget })).filter((entry) => !entry.result.allowed);
  const worst = blocked[0];
  if (worst) {
    const latest = blocked.reduce((acc, entry) => (entry.result.resetAt > acc.result.resetAt ? entry : acc), worst);
    throw new RateLimitError(latest.result.resetAt, { limit: latest.budget.limit, remaining: latest.result.remaining });
  }
}
