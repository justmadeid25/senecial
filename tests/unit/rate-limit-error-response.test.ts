import { describe, expect, it } from "vitest";

import { RateLimitError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";

describe("errorResponse RateLimitError handling (Phase 10A §21 - RateLimit-* headers)", () => {
  it("always sets Retry-After and RateLimit-Reset", () => {
    const resetAt = new Date(Date.now() + 30_000);
    const response = errorResponse(new RateLimitError(resetAt), "req-1");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("RateLimit-Reset")).toBeTruthy();
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("sets RateLimit-Limit/RateLimit-Remaining when the error carries them", () => {
    const resetAt = new Date(Date.now() + 30_000);
    const response = errorResponse(new RateLimitError(resetAt, { limit: 10, remaining: 0 }), "req-2");
    expect(response.headers.get("RateLimit-Limit")).toBe("10");
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
  });

  it("omits RateLimit-Limit/RateLimit-Remaining rather than fabricating them when not provided", () => {
    const resetAt = new Date(Date.now() + 30_000);
    const response = errorResponse(new RateLimitError(resetAt), "req-3");
    expect(response.headers.get("RateLimit-Limit")).toBeNull();
    expect(response.headers.get("RateLimit-Remaining")).toBeNull();
  });

  it("Retry-After is always at least 1 even for a resetAt in the past", () => {
    const response = errorResponse(new RateLimitError(new Date(Date.now() - 5000)), "req-4");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("never leaks the internal error message for a non-AppError", async () => {
    const response = errorResponse(new Error("pg: connection to 10.0.0.5 refused"), "req-5");
    const body = (await response.json()) as { message: string };
    expect(response.status).toBe(500);
    expect(body.message).not.toContain("10.0.0.5");
  });
});
