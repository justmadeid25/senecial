import { NextResponse } from "next/server";

import { resolveRequestId } from "@/domain/logging/request-id";
import { checkReadiness } from "@/features/health/server/check-readiness";
import { withRouteMetrics } from "@/server/monitoring/metrics";

/**
 * §34/§35 - public, minimal-information readiness endpoint: only
 * ok/error per dependency (database/storage/config), never a host, path,
 * version, or commit hash. A load balancer/orchestrator uses this to
 * decide whether to route traffic to this instance. 503 on any failed
 * check. Carries `X-Request-Id` like every other custom Route Handler in
 * this app (Phase 9.1 - found missing here during a real header audit).
 */
export async function GET(request: Request) {
  return withRouteMetrics("/api/health/ready", async () => {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    const result = await checkReadiness();
    return NextResponse.json(result, {
      status: result.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  });
}
