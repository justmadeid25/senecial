import { NextResponse } from "next/server";

import { AppError, RateLimitError } from "@/lib/errors";
import { getLogger } from "@/server/logging";
import { toSafeBatchErrorCode } from "@/server/batch/safe-error-code";

/**
 * §33 - single place every Route Handler in this app maps a thrown error
 * to an HTTP response. Every AppError subclass already carries its own
 * `statusCode` (see lib/errors/app-error.ts), so this needs no per-error
 * type switch beyond the RateLimitError special case (which additionally
 * needs a `Retry-After` header). An error that is not an AppError at all
 * is never shown to the client (no stack trace, no raw Prisma error) -
 * only logged server-side with a safe, generic errorCode and the
 * request's correlation id, and reported to the client as a generic 500
 * with that same request id so a user can reference it when asking for
 * support.
 */
export function errorResponse(
  error: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  const headers = { "X-Request-Id": requestId, ...extraHeaders };

  if (error instanceof RateLimitError) {
    const retryAfterSeconds = Math.max(1, Math.ceil((error.resetAt.getTime() - Date.now()) / 1000));
    const rateLimitHeaders: Record<string, string> = {
      ...headers,
      "Retry-After": String(retryAfterSeconds),
      "RateLimit-Reset": String(retryAfterSeconds),
    };
    // §21 - limit/remaining are only known when the throwing call site had
    // a single well-defined budget to report (see enforce-rate-limit.ts) -
    // omitted rather than sent as 0/undefined-as-string when not available,
    // since an absent header is honest while a fabricated "0" is not.
    if (error.limit !== undefined) {
      rateLimitHeaders["RateLimit-Limit"] = String(error.limit);
    }
    if (error.remaining !== undefined) {
      rateLimitHeaders["RateLimit-Remaining"] = String(error.remaining);
    }
    return NextResponse.json({ message: error.message, requestId }, { status: 429, headers: rateLimitHeaders });
  }

  if (error instanceof AppError) {
    return NextResponse.json({ message: error.message, requestId }, { status: error.statusCode, headers });
  }

  getLogger().error("http.unhandled_error", { requestId, errorCode: toSafeBatchErrorCode(error) });
  return NextResponse.json(
    { message: "요청을 처리하는 중 오류가 발생했습니다.", requestId },
    { status: 500, headers }
  );
}
