import { describe, expect, it } from "vitest";

import { extractSearchPatternKeys } from "@/domain/ai/search-pattern-extraction";

describe("extractSearchPatternKeys (Phase 12 Part K §Organization Memory)", () => {
  it("returns short stems, never the raw question text", () => {
    const keys = extractSearchPatternKeys("계약을 해지하려면 어떻게 해야 하나요?");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.length).toBeLessThanOrEqual(2);
    }
    expect(keys.join(" ")).not.toContain("해지하려면");
  });

  it("deduplicates stems from different inflected forms of the same word", () => {
    const keys = extractSearchPatternKeys("해지하는 경우와 해지할 수 있는 경우");
    const uniqueStems = new Set(keys);
    expect(uniqueStems.size).toBe(keys.length);
  });

  it("returns an empty array for a question with no meaningful keywords", () => {
    expect(extractSearchPatternKeys("은 는 이 가")).toEqual([]);
  });
});
