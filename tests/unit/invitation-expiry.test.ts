import { describe, expect, it } from "vitest";

import {
  INVITATION_EXPIRY_DAYS,
  computeInvitationExpiresAt,
  isInvitationExpired,
} from "@/domain/invitations/invitation-expiry";

describe("computeInvitationExpiresAt", () => {
  it(`returns a date ${INVITATION_EXPIRY_DAYS} days after "now"`, () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeInvitationExpiresAt(now);
    const diffDays = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(INVITATION_EXPIRY_DAYS);
  });
});

describe("isInvitationExpired", () => {
  it("returns false when now is before expiresAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-08T00:00:00.000Z");
    expect(isInvitationExpired(expiresAt, now)).toBe(false);
  });

  it("returns true when now is after expiresAt", () => {
    const now = new Date("2026-01-09T00:00:00.000Z");
    const expiresAt = new Date("2026-01-08T00:00:00.000Z");
    expect(isInvitationExpired(expiresAt, now)).toBe(true);
  });

  it("treats the exact expiry instant as already expired (inclusive)", () => {
    const instant = new Date("2026-01-08T00:00:00.000Z");
    expect(isInvitationExpired(instant, instant)).toBe(true);
  });
});
