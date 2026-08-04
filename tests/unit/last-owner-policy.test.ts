import { describe, expect, it } from "vitest";

import { isLastOwner } from "@/domain/members/last-owner-policy";

describe("isLastOwner", () => {
  it("returns true when there is exactly one OWNER", () => {
    expect(isLastOwner(1)).toBe(true);
  });

  it("returns true defensively for zero OWNERs", () => {
    expect(isLastOwner(0)).toBe(true);
  });

  it("returns false when there are two or more OWNERs", () => {
    expect(isLastOwner(2)).toBe(false);
    expect(isLastOwner(5)).toBe(false);
  });
});
