import { describe, expect, it, vi } from "vitest";

import { parseMaxUploadSizeMb } from "@/lib/config/file-upload";

describe("parseMaxUploadSizeMb", () => {
  it("returns the default (20) when the env var is unset", () => {
    expect(parseMaxUploadSizeMb(undefined)).toBe(20);
  });

  it("returns the default when the env var is an empty string", () => {
    expect(parseMaxUploadSizeMb("")).toBe(20);
  });

  it("parses a valid positive number", () => {
    expect(parseMaxUploadSizeMb("15")).toBe(15);
    expect(parseMaxUploadSizeMb("50")).toBe(50);
  });

  it("falls back to the default and warns for a non-numeric value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMaxUploadSizeMb("not-a-number")).toBe(20);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to the default and warns for a negative or zero value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMaxUploadSizeMb("-5")).toBe(20);
    expect(parseMaxUploadSizeMb("0")).toBe(20);
    warnSpy.mockRestore();
  });
});
