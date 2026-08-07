import { describe, expect, it } from "vitest";

import { computeCanaryBucket } from "@/domain/ai/canary-assignment";
import { selectProviderGroup } from "@/domain/ai/provider-routing";
import type { AiRolloutConfiguration } from "@/domain/ai/rollout-configuration";

function rollout(overrides: Partial<AiRolloutConfiguration> = {}): AiRolloutConfiguration {
  return {
    canaryEnabled: true,
    canaryPercentage: 50,
    canaryEmbeddingProvider: "openai",
    canaryEmbeddingModel: "canary-model",
    canaryLlmProvider: "openai",
    canaryLlmModel: "canary-model",
    ...overrides,
  };
}

describe("selectProviderGroup (Phase 13.1 §10/§11)", () => {
  it("returns primary when canary is disabled, regardless of percentage", () => {
    const group = selectProviderGroup({
      organizationId: "org-1",
      rollout: rollout({ canaryEnabled: false, canaryPercentage: 100 }),
      canaryProviderConfigured: true,
    });
    expect(group).toBe("primary");
  });

  it("returns primary when no canary provider is actually configured, even if canaryEnabled+percentage would otherwise route to canary", () => {
    const group = selectProviderGroup({
      organizationId: "org-1",
      rollout: rollout({ canaryPercentage: 100 }),
      canaryProviderConfigured: false,
    });
    expect(group).toBe("primary");
  });

  it("0% never routes any organization to canary", () => {
    for (const organizationId of ["org-a", "org-b", "org-c", "org-d", "org-e"]) {
      expect(selectProviderGroup({ organizationId, rollout: rollout({ canaryPercentage: 0 }), canaryProviderConfigured: true })).toBe(
        "primary"
      );
    }
  });

  it("100% always routes every organization to canary", () => {
    for (const organizationId of ["org-a", "org-b", "org-c", "org-d", "org-e"]) {
      expect(selectProviderGroup({ organizationId, rollout: rollout({ canaryPercentage: 100 }), canaryProviderConfigured: true })).toBe(
        "canary"
      );
    }
  });

  it.each([5, 25, 50])("at %i%%, an organization's bucket precisely determines its group (matches computeCanaryBucket directly)", (percentage) => {
    for (const organizationId of ["org-1", "org-2", "org-3", "org-4", "org-5", "org-6", "org-7", "org-8"]) {
      const bucket = computeCanaryBucket(organizationId);
      const expected = bucket < percentage ? "canary" : "primary";
      expect(selectProviderGroup({ organizationId, rollout: rollout({ canaryPercentage: percentage }), canaryProviderConfigured: true })).toBe(
        expected
      );
    }
  });

  it("the SAME organization gets the SAME group across repeated calls (stability)", () => {
    const params = { organizationId: "org-stability", rollout: rollout({ canaryPercentage: 50 }), canaryProviderConfigured: true };
    const first = selectProviderGroup(params);
    for (let i = 0; i < 20; i++) {
      expect(selectProviderGroup(params)).toBe(first);
    }
  });

  it("distributes organizations across primary/canary in roughly the configured proportion (50%, 500 orgs)", () => {
    const orgIds = Array.from({ length: 500 }, (_, i) => `distribution-org-${i}`);
    const canaryCount = orgIds.filter(
      (organizationId) => selectProviderGroup({ organizationId, rollout: rollout({ canaryPercentage: 50 }), canaryProviderConfigured: true }) === "canary"
    ).length;
    // Not an exact 250/500 (hash-based, not a perfect shuffle) - a generous band confirms it's a real distribution, not a constant.
    expect(canaryCount).toBeGreaterThan(150);
    expect(canaryCount).toBeLessThan(350);
  });

  it("embedding and LLM routing use the identical bucket for the same organization (never independently randomized)", () => {
    const organizationId = "org-consistency";
    const rolloutConfig = rollout({ canaryPercentage: 50 });
    // Both legs delegate to the exact same selectProviderGroup() with the same organizationId+rollout - calling it "twice" (once per leg, as the real factories do) must agree.
    const embeddingGroup = selectProviderGroup({ organizationId, rollout: rolloutConfig, canaryProviderConfigured: true });
    const llmGroup = selectProviderGroup({ organizationId, rollout: rolloutConfig, canaryProviderConfigured: true });
    expect(embeddingGroup).toBe(llmGroup);
  });
});
