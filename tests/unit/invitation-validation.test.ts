import { describe, expect, it } from "vitest";

import {
  createInvitationSchema,
  registerAndAcceptInvitationSchema,
} from "@/lib/validation/invitations";

describe("createInvitationSchema / email normalization", () => {
  it("trims and lowercases the invited email", () => {
    const result = createInvitationSchema.parse({ email: "  Invitee@Example.COM  " });
    expect(result.email).toBe("invitee@example.com");
  });

  it("rejects a malformed email", () => {
    expect(createInvitationSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("defaults role to MEMBER when omitted", () => {
    const result = createInvitationSchema.parse({ email: "a@b.com" });
    expect(result.role).toBe("MEMBER");
  });

  it("accepts an explicit OWNER role", () => {
    const result = createInvitationSchema.parse({ email: "a@b.com", role: "OWNER" });
    expect(result.role).toBe("OWNER");
  });

  it("rejects an invalid role value", () => {
    expect(
      createInvitationSchema.safeParse({ email: "a@b.com", role: "SUPERADMIN" }).success
    ).toBe(false);
  });
});

describe("registerAndAcceptInvitationSchema", () => {
  const valid = { name: "홍길동", password: "Password1234", confirmPassword: "Password1234" };

  it("accepts matching passwords", () => {
    expect(registerAndAcceptInvitationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = registerAndAcceptInvitationSchema.safeParse({
      ...valid,
      confirmPassword: "Different1234",
    });
    expect(result.success).toBe(false);
  });

  it("has no email field to tamper with", () => {
    const result = registerAndAcceptInvitationSchema.parse(valid);
    expect("email" in result).toBe(false);
  });
});
