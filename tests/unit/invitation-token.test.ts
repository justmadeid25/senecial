import { describe, expect, it } from "vitest";

import { generateInvitationToken, hashInvitationToken } from "@/server/auth/invitation-token";

describe("generateInvitationToken", () => {
  it("generates a URL-safe, sufficiently long token", () => {
    const token = generateInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).not.toBe(b);
  });
});

describe("hashInvitationToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateInvitationToken();
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
  });

  it("produces a different hash for a different token", () => {
    expect(hashInvitationToken("token-a")).not.toBe(hashInvitationToken("token-b"));
  });

  it("never returns the original token", () => {
    const token = "plain-text-token-value";
    expect(hashInvitationToken(token)).not.toBe(token);
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const hash = hashInvitationToken("anything");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
