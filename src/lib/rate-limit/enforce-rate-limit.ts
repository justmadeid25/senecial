import { RATE_LIMIT_BUDGETS, type RateLimitPurpose } from "@/lib/config/rate-limit";
import { RateLimitError } from "@/lib/errors";
import { getClientIpPrefix } from "@/lib/http/client-ip";
import { buildRateLimitKey } from "@/domain/rate-limit/rate-limit-key";
import { getRateLimiter } from "@/server/services/rate-limit";

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

  const result = await getRateLimiter().consume({
    key,
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
  });

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

  const results = await Promise.all(
    axes.map((axis) => limiter.consume({ key: axis.key, limit: axis.budget.limit, windowSeconds: axis.budget.windowSeconds }))
  );

  const blocked = results.map((result, i) => ({ result, budget: axes[i]!.budget })).filter((entry) => !entry.result.allowed);
  const worst = blocked[0];
  if (worst) {
    const latest = blocked.reduce((acc, entry) => (entry.result.resetAt > acc.result.resetAt ? entry : acc), worst);
    throw new RateLimitError(latest.result.resetAt, { limit: latest.budget.limit, remaining: latest.result.remaining });
  }
}
