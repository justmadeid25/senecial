import { describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { hasRequiredRole } from "@/lib/permissions/verify-membership";

describe("hasRequiredRole", () => {
  it("returns true when the role matches a single allowed role", () => {
    expect(hasRequiredRole(MembershipRole.OWNER, MembershipRole.OWNER)).toBe(true);
  });

  it("returns false when the role does not match a single allowed role", () => {
    expect(hasRequiredRole(MembershipRole.MEMBER, MembershipRole.OWNER)).toBe(false);
  });

  it("returns true when the role is included in an allowed-role list", () => {
    expect(
      hasRequiredRole(MembershipRole.MEMBER, [MembershipRole.OWNER, MembershipRole.MEMBER])
    ).toBe(true);
  });

  it("returns false when the role is not included in an allowed-role list", () => {
    expect(hasRequiredRole(MembershipRole.MEMBER, [MembershipRole.OWNER])).toBe(false);
  });
});
