import { NextResponse } from "next/server";

import { renderPrometheusMetrics, withRouteMetrics } from "@/server/monitoring/metrics";

/**
 * Phase 11 §Metrics endpoint - Prometheus text exposition format. NEVER
 * exposed without auth: requires `Authorization: Bearer <METRICS_TOKEN>`
 * matching `process.env.METRICS_TOKEN` exactly. Two failure modes are
 * both a plain 404 (never 401/403) - deliberately indistinguishable from
 * "this route doesn't exist" to anyone probing without the token:
 *
 *  - METRICS_TOKEN unset: metrics are not exposed at all (safe default -
 *    an operator must opt in explicitly, same "explicit opt-in" pattern
 *    as every ALLOW_* production guard elsewhere in this codebase).
 *  - token missing/mismatched: never reveals that a real endpoint exists
 *    at all versus simply being wrong.
 *
 * A reverse proxy in front of this app should additionally block external
 * traffic to this path entirely (see docs/operations/monitoring.md) -
 * this token check is defense in depth, not the only boundary.
 */
export async function GET(request: Request) {
  return withRouteMetrics("/api/metrics", async () => {
    const expectedToken = process.env.METRICS_TOKEN;
    if (!expectedToken) {
      return new NextResponse(null, { status: 404 });
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (providedToken !== expectedToken) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(renderPrometheusMetrics(), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  });
}
