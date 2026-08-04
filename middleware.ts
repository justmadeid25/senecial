import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildSecurityHeaders } from "./src/domain/security/security-headers";

const TOKEN_PATH_PATTERN = /^\/(invitations|verify-email|reset-password)\//;

/**
 * Phase 9 §25/§26/§38 - applies the shared security header set (CSP,
 * X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
 * X-Frame-Options, and - production+HTTPS only - HSTS) to every response.
 *
 * `x-forwarded-proto` is only trustworthy when set by a trusted reverse
 * proxy in front of this app (see README's reverse-proxy checklist) - this
 * matches getClientIpPrefix()'s same caveat about X-Forwarded-For.
 *
 * Token-bearing routes (invitation/email-verification/password-reset
 * links) additionally get `Cache-Control: no-store` and a route-specific
 * `Referrer-Policy: no-referrer` override (stricter than the global
 * `strict-origin-when-cross-origin` - these URLs must never leak via the
 * Referer header at all), same rationale as before this middleware
 * covered every route.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const isHttps =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const headers = buildSecurityHeaders({
    isProduction: process.env.NODE_ENV === "production",
    isHttps,
  });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }

  if (TOKEN_PATH_PATTERN.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Every route except Next.js's own static assets/image optimizer -
     * those are immutable, fingerprinted files that don't need CSP/HSTS
     * and adding headers to them would only cost overhead.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
