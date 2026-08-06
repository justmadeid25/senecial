import { describe, expect, it } from "vitest";

import { estimateAiCostMinor, formatCostMinorAsUsd, type PricingTable } from "@/domain/ai/pricing";

const TEST_TABLE: PricingTable = {
  pricingVersion: "test-v1",
  currency: "USD",
  effectiveFrom: "2026-01-01",
  models: {
    "openai/test-model": { inputCostPerMillionMinor: 1_000_000, outputCostPerMillionMinor: 2_000_000, embeddingCostPerMillionMinor: 500_000 },
  },
};

describe("estimateAiCostMinor (Phase 13 §23/§24)", () => {
  it("computes input+output cost in USD micro-cents using BigInt, never a float", () => {
    const result = estimateAiCostMinor({
      provider: "openai",
      model: "test-model",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      pricingTable: TEST_TABLE,
    });
    expect(typeof result.estimatedCostMinor).toBe("bigint");
    // 1_000_000 input tokens * 1_000_000 minor/1M = 1_000_000; 500_000 output tokens * 2_000_000/1M = 1_000_000; total 2_000_000
    expect(result.estimatedCostMinor).toBe(BigInt(2_000_000));
  });

  it("computes embedding-only cost", () => {
    const result = estimateAiCostMinor({ provider: "openai", model: "test-model", embeddingTokens: 2_000_000, pricingTable: TEST_TABLE });
    expect(result.estimatedCostMinor).toBe(BigInt(1_000_000));
  });

  it("returns null (never 0) for an unpriced model - unknown cost is never disguised as free", () => {
    const result = estimateAiCostMinor({ provider: "development", model: "hashing-trick-v1", embeddingTokens: 1000, pricingTable: TEST_TABLE });
    expect(result.estimatedCostMinor).toBeNull();
  });

  it("zero tokens produces zero cost (not null) for a known-priced model", () => {
    const result = estimateAiCostMinor({ provider: "openai", model: "test-model", inputTokens: 0, outputTokens: 0, pricingTable: TEST_TABLE });
    expect(result.estimatedCostMinor).toBe(BigInt(0));
  });

  it("large token counts never lose precision to float rounding", () => {
    const result = estimateAiCostMinor({ provider: "openai", model: "test-model", inputTokens: 999_999_999, pricingTable: TEST_TABLE });
    // 999_999_999 * 1_000_000 / 1_000_000 = 999_999_999 exactly - a float would risk rounding at this scale.
    expect(result.estimatedCostMinor).toBe(BigInt(999_999_999));
  });
});

describe("formatCostMinorAsUsd", () => {
  it("formats a BigInt micro-cent amount as a dollar string", () => {
    expect(formatCostMinorAsUsd(BigInt(1_500_000))).toBe("$1.500000");
  });

  it("formats null as an explicit unknown marker, never $0.00", () => {
    expect(formatCostMinorAsUsd(null)).not.toContain("$0");
  });
});
