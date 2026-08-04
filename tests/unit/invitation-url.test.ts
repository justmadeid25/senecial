import { describe, expect, it } from "vitest";

import { buildInvitationUrl } from "@/domain/invitations/invitation-url";

describe("buildInvitationUrl", () => {
  it("joins the app URL and token into a /invitations/{token} path", () => {
    expect(buildInvitationUrl("http://localhost:3000", "abc123")).toBe(
      "http://localhost:3000/invitations/abc123"
    );
  });

  it("strips a trailing slash on the app URL before joining", () => {
    expect(buildInvitationUrl("https://app.example.com/", "tok")).toBe(
      "https://app.example.com/invitations/tok"
    );
  });
});
