import { describe, expect, it } from "vitest";

import {
  MAX_STORAGE_DELETE_ATTEMPTS,
  shouldRetryStorageDelete,
  toSafeStorageDeleteError,
} from "@/domain/contract-files/reconciliation-policy";

describe("shouldRetryStorageDelete", () => {
  it("returns true when attempts is below the max", () => {
    expect(shouldRetryStorageDelete(0)).toBe(true);
    expect(shouldRetryStorageDelete(MAX_STORAGE_DELETE_ATTEMPTS - 1)).toBe(true);
  });

  it("returns false once attempts reaches the max", () => {
    expect(shouldRetryStorageDelete(MAX_STORAGE_DELETE_ATTEMPTS)).toBe(false);
    expect(shouldRetryStorageDelete(MAX_STORAGE_DELETE_ATTEMPTS + 1)).toBe(false);
  });
});

describe("toSafeStorageDeleteError", () => {
  it("extracts the message from an Error instance", () => {
    expect(toSafeStorageDeleteError(new Error("ENOENT: no such file"))).toBe(
      "ENOENT: no such file"
    );
  });

  it("stringifies a non-Error thrown value", () => {
    expect(toSafeStorageDeleteError("plain string error")).toBe("plain string error");
  });

  it("truncates an overly long message", () => {
    const longMessage = "x".repeat(1000);
    const result = toSafeStorageDeleteError(new Error(longMessage));
    expect(result.length).toBeLessThan(1000);
    expect(result.endsWith("...")).toBe(true);
  });

  it("never includes a stack trace", () => {
    const error = new Error("short message");
    const result = toSafeStorageDeleteError(error);
    expect(result).not.toContain("at ");
    expect(result).not.toContain(".ts:");
  });
});
