import { NextResponse } from "next/server";

import { buildSafeCsvFilename, withUtf8Bom } from "@/domain/analytics/csv";
import { resolveRequestId } from "@/domain/logging/request-id";
import { analyticsExportTypeSchema } from "@/lib/validation/analytics";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { errorResponse } from "@/lib/http/error-response";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { NotFoundError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";
import { exportAnalyticsCsv } from "@/features/analytics/server/export-analytics-csv";
import { withRouteMetrics } from "@/server/monitoring/metrics";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * §29-33 - OWNER-only CSV export (re-verified in exportAnalyticsCsv() via
 * DB membership, never trusting the session role claim), always
 * `Cache-Control: private, no-store` (analytics data is org-sensitive, must
 * never be a candidate for a shared/public cache or Next.js static
 * generation), and a CRLF/quote-injection-proof filename built from a fixed
 * ASCII base plus today's date only (never from user input). Every error
 * path (auth, rate limit, not-found export type, internal) goes through
 * the same errorResponse() mapping so the response shape/status/request-id
 * handling can never drift between branches.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withRouteMetrics("/api/analytics/export/[type]", async () => {
    try {
      const authContext = await requireOrganizationMembership();

      const { type } = await params;
      const parsedType = analyticsExportTypeSchema.safeParse(type);
      if (!parsedType.success) {
        throw new NotFoundError();
      }

      await enforceRateLimit("csvExport", authContext.userId);

      const url = new URL(request.url);
      const rawFilters = Object.fromEntries(url.searchParams.entries());

      const result = await exportAnalyticsCsv({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        exportType: parsedType.data,
        rawFilters,
      });

      const dateSuffix = new Date().toISOString().slice(0, 10);
      const filename = buildSafeCsvFilename(result.filenameBase, dateSuffix);

      return new NextResponse(withUtf8Bom(result.csv), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": buildContentDisposition(filename),
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId,
          ...NO_STORE,
        },
      });
    } catch (error) {
      return errorResponse(error, requestId, NO_STORE);
    }
  });
}
