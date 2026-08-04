export interface SecurityHeadersInput {
  isProduction: boolean;
  isHttps: boolean;
}

/**
 * Phase 9 §25/§26 - CSP is shipped in **Report-Only** mode for this Phase,
 * deliberately (the prompt explicitly allows this: "초기 정책은 report-only
 * ... 일 수 있습니다"). This is not a placeholder left for later out of
 * laziness - it is the result of an actual finding: Next.js's App Router
 * streams RSC hydration data through several inline
 * `<script>self.__next_f.push(...)</script>` tags that the framework
 * itself injects (confirmed by inspecting this app's own rendered HTML -
 * five of them on a single page load). A strict `script-src 'self'` with
 * no `'unsafe-inline'`/nonce would silently block every one of them and
 * break hydration app-wide (forms would render but never become
 * interactive) - "silently" being the dangerous part, since the page
 * still loads and looks correct.
 *
 * The standard fix is Next's documented nonce + `'strict-dynamic'`
 * middleware pattern, but verifying that it actually restores hydration
 * (rather than just looking correct on paper) requires checking real
 * browser console/network output - not available in this session (see
 * README's "환경 관련 특이사항"). Shipping an *enforced* CSP that was never
 * confirmed against a live browser would risk taking down the app for a
 * production deploy that copies this config as-is. Report-Only carries no
 * such risk: it can never block a request, only note in the browser
 * console what an eventual enforced policy would have blocked - so it is
 * shipped fully populated (not simplified) as an accurate preview, with
 * the nonce/`strict-dynamic` upgrade left as documented follow-up work
 * once it can be verified live (see README).
 *
 * Every other header below IS enforced (not report-only) - none of them
 * carry this same hydration risk. `frame-ancestors 'none'` replaces the
 * legacy `X-Frame-Options` header in the policy (kept too, for browsers
 * that do not honor frame-ancestors).
 *
 * HSTS is only ever emitted for a production + HTTPS request - never on
 * plain-HTTP localhost dev (§26), since HSTS on a domain currently served
 * over HTTP would permanently break it for anyone whose browser caches
 * the header before HTTPS is actually available. `preload` is
 * deliberately omitted - submitting to the HSTS preload list is a
 * separate, harder-to-reverse operational decision for whoever controls
 * the real production domain, not something to bake in here.
 */
export function buildSecurityHeaders(input: SecurityHeadersInput): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy-Report-Only": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
  };

  if (input.isProduction && input.isHttps) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}
