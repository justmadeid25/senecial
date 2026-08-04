function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

interface RateLimitBudget {
  limit: number;
  windowSeconds: number;
}

function budget(purpose: string, defaultLimit: number, defaultWindowSeconds: number): RateLimitBudget {
  const prefix = `RATE_LIMIT_${purpose.toUpperCase().replace(/-/g, "_")}`;
  return {
    limit: parsePositiveInt(process.env[`${prefix}_MAX`], defaultLimit, `${prefix}_MAX`),
    windowSeconds: parsePositiveInt(
      process.env[`${prefix}_WINDOW_SECONDS`],
      defaultWindowSeconds,
      `${prefix}_WINDOW_SECONDS`
    ),
  };
}

/**
 * Phase 9 §16 - one budget per rate-limited purpose, each independently
 * env-configurable (RATE_LIMIT_<PURPOSE>_MAX / _WINDOW_SECONDS). Defaults
 * are generous enough not to block a legitimate user under normal use
 * while still bounding brute-force/spam volume.
 */
export const RATE_LIMIT_BUDGETS = {
  login: budget("login", 10, 5 * 60),
  /**
   * Phase 10A §19 - multi-axis login limiting. `login` above stays the
   * original per-(email, IP prefix) combined-axis budget (unchanged, for
   * backward compatibility). These two add independent axes so that
   * neither rotating the email (password spraying from one IP) nor
   * rotating the IP (credential stuffing against one account) alone
   * escapes throttling - `enforceLoginRateLimit()` requires all three to
   * be within budget. `loginByIp` is deliberately more generous than
   * `loginByIdentifier` since an IP /24 prefix can legitimately be shared
   * by many unrelated users (NAT, corporate networks, mobile carriers).
   */
  loginByIdentifier: budget("login_by_identifier", 10, 5 * 60),
  loginByIp: budget("login_by_ip", 30, 5 * 60),
  signup: budget("signup", 5, 60 * 60),
  emailVerificationResend: budget("email_verification_resend", 5, 60 * 60),
  passwordResetRequest: budget("password_reset_request", 5, 60 * 60),
  passwordResetExecute: budget("password_reset_execute", 10, 60 * 60),
  invitationCreate: budget("invitation_create", 20, 60 * 60),
  invitationResend: budget("invitation_resend", 10, 60 * 60),
  invitationAcceptFailure: budget("invitation_accept_failure", 10, 15 * 60),
  fileUpload: budget("file_upload", 30, 60 * 60),
  csvExport: budget("csv_export", 20, 60 * 60),
  memberRoleChange: budget("member_role_change", 30, 60 * 60),
  /** Phase 12 §Rate Limit - "AI Endpoint 별도 Rate Limit". Deliberately its own budget, separate from every other purpose above - an LLM call is orders of magnitude more expensive (latency + real provider cost, once a real provider is configured) than any other rate-limited action in this app, so it gets a tighter default. */
  aiAsk: budget("ai_ask", 20, 60 * 60),
} as const;

export type RateLimitPurpose = keyof typeof RATE_LIMIT_BUDGETS;
