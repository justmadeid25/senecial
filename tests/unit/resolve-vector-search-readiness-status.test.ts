import { describe, expect, it } from "vitest";

import { resolveVectorSearchReadinessStatus } from "@/features/health/server/check-readiness";

describe("resolveVectorSearchReadinessStatus (Phase 12.1 §13/§20 - production fallback guard)", () => {
  it("is ok when the configured provider is 'application' regardless of probe outcome", () => {
    expect(
      resolveVectorSearchReadinessStatus({ driver: "application", probeSucceeded: false, allowFallback: false })
    ).toBe("ok");
    expect(
      resolveVectorSearchReadinessStatus({ driver: "application", probeSucceeded: true, allowFallback: false })
    ).toBe("ok");
  });

  it("is ok when the provider is pgvector and the probe succeeded", () => {
    expect(resolveVectorSearchReadinessStatus({ driver: "pgvector", probeSucceeded: true, allowFallback: false })).toBe(
      "ok"
    );
  });

  it("is error when the provider is pgvector, the probe failed, and fallback is not allowed - the default, safe behavior (§12 'never a silent per-request fallback')", () => {
    expect(resolveVectorSearchReadinessStatus({ driver: "pgvector", probeSucceeded: false, allowFallback: false })).toBe(
      "error"
    );
  });

  it("is ok when the provider is pgvector, the probe failed, but AI_VECTOR_SEARCH_ALLOW_FALLBACK is explicitly true", () => {
    expect(resolveVectorSearchReadinessStatus({ driver: "pgvector", probeSucceeded: false, allowFallback: true })).toBe(
      "ok"
    );
  });
});
