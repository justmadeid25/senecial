import { describe, expect, it } from "vitest";

import { shouldSampleForShadow } from "@/domain/ai/shadow-sampling";

describe("shouldSampleForShadow (Phase 13 §20)", () => {
  it("sampleRate 0 never samples", () => {
    expect(shouldSampleForShadow(0, () => 0)).toBe(false);
  });

  it("sampleRate 1 always samples", () => {
    expect(shouldSampleForShadow(1, () => 0.999)).toBe(true);
  });

  it("samples iff the random draw is below the rate", () => {
    expect(shouldSampleForShadow(0.5, () => 0.4)).toBe(true);
    expect(shouldSampleForShadow(0.5, () => 0.6)).toBe(false);
  });
});
