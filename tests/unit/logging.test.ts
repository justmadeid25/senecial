import { describe, expect, it, vi } from "vitest";

import { maskEmail, redactLogData } from "@/domain/logging/redact";
import { parseIncomingRequestId, resolveRequestId } from "@/domain/logging/request-id";
import { JsonConsoleLogger } from "@/server/logging/json-console-logger";

describe("redactLogData / maskEmail (§31)", () => {
  it("redacts keys that look like credentials/secrets regardless of value", () => {
    const redacted = redactLogData({
      password: "hunter2",
      passwordHash: "$argon2id$...",
      token: "abc123",
      secret: "xyz",
      cookie: "session=abc",
      authorization: "Bearer abc",
      DATABASE_URL: "postgresql://user:pass@host/db",
      storageKey: "org/file.pdf",
    });
    expect(redacted).toEqual({
      password: "[REDACTED]",
      passwordHash: "[REDACTED]",
      token: "[REDACTED]",
      secret: "[REDACTED]",
      cookie: "[REDACTED]",
      authorization: "[REDACTED]",
      DATABASE_URL: "[REDACTED]",
      storageKey: "[REDACTED]",
    });
  });

  it("masks the local part of an email field but keeps the domain", () => {
    const redacted = redactLogData({ email: "justmadeid@gmail.com" });
    expect(redacted?.email).toBe(`j${"*".repeat(9)}@gmail.com`);
    expect(redacted?.email).not.toContain("justmadeid");
  });

  it("passes through non-sensitive fields unchanged", () => {
    const redacted = redactLogData({ requestId: "abc-123", processedCount: 5, ok: true, missing: undefined });
    expect(redacted).toEqual({ requestId: "abc-123", processedCount: 5, ok: true, missing: undefined });
  });

  it("maskEmail falls back to full redaction for a malformed address", () => {
    expect(maskEmail("not-an-email")).toBe("[REDACTED]");
  });
});

describe("request-id (§32)", () => {
  it("accepts a well-formed UUID", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(parseIncomingRequestId(uuid)).toBe(uuid);
  });

  it("rejects a malformed or oversized incoming value", () => {
    expect(parseIncomingRequestId("not-a-uuid")).toBeUndefined();
    expect(parseIncomingRequestId("a".repeat(200))).toBeUndefined();
    expect(parseIncomingRequestId(null)).toBeUndefined();
    expect(parseIncomingRequestId(undefined)).toBeUndefined();
  });

  it("resolveRequestId falls back to a generated id when the incoming value is invalid", () => {
    const id = resolveRequestId("<script>alert(1)</script>");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("JsonConsoleLogger (§31)", () => {
  it("writes a single JSON line with timestamp/level/event and redacted data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    new JsonConsoleLogger().info("test.event", { password: "hunter2", count: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("test.event");
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.count).toBe(3);
    expect(typeof parsed.timestamp).toBe("string");

    spy.mockRestore();
  });
});
