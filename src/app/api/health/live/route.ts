import { NextResponse } from "next/server";

import { resolveRequestId } from "@/domain/logging/request-id";
import { withRouteMetrics } from "@/server/monitoring/metrics";

/**
 * §34 - process-liveness only. No DB query, no IO - if this handler can
 * run at all, the process is alive. A load balancer/orchestrator uses
 * this to decide whether to restart the container; it should never fail
 * just because the database is temporarily unreachable (that is what
 * /api/health/ready is for). Carries `X-Request-Id` like every other
 * custom Route Handler in this app.
 */
export async function GET(request: Request) {
  return withRouteMetrics("/api/health/live", async () => {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    return NextResponse.json(
      { status: "ok" },
      { status: 200, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  });
}
