import { describe, expect, it } from "vitest";

import { computeCanaryBucket, isOrganizationInCanary } from "@/domain/ai/canary-assignment";

describe("canary-assignment (Phase 13 §21 - stable hash-based rollout)", () => {
  it("the same organizationId always produces the same bucket", () => {
    const bucket1 = computeCanaryBucket("org-abc123");
    const bucket2 = computeCanaryBucket("org-abc123");
    expect(bucket1).toBe(bucket2);
    expect(bucket1).toBeGreaterThanOrEqual(0);
    expect(bucket1).toBeLessThan(100);
  });

  it("0% never includes any organization", () => {
    expect(isOrganizationInCanary("org-1", 0)).toBe(false);
    expect(isOrganizationInCanary("org-2", 0)).toBe(false);
  });

  it("100% always includes every organization", () => {
    expect(isOrganizationInCanary("org-1", 100)).toBe(true);
    expect(isOrganizationInCanary("org-2", 100)).toBe(true);
  });

  it("raising the rollout percentage never removes an organization already in canary (monotonic)", () => {
    const orgId = "org-stability-check";
    const bucket = computeCanaryBucket(orgId);
    const percentageIn = Math.min(99, bucket + 1);
    expect(isOrganizationInCanary(orgId, percentageIn)).toBe(true);
    // Any higher percentage must still include it.
    expect(isOrganizationInCanary(orgId, 100)).toBe(true);
  });

  it("different organizations distribute across buckets (not all mapped to the same value)", () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => computeCanaryBucket(`org-${i}`)));
    expect(buckets.size).toBeGreaterThan(10);
  });
});
