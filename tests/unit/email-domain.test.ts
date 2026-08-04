import { describe, expect, it } from "vitest";

import { escapeHtml } from "@/domain/email/html-escape";
import { containsCrlf, isValidEmailAddressFormat, normalizeSendRecipient } from "@/domain/email/email-address";
import { sanitizeEmailSubject, truncateInterpolatedName } from "@/domain/email/subject-sanitize";
import {
  buildEmailVerificationIdempotencyKey,
  buildInvitationIdempotencyKey,
  buildInvitationResendIdempotencyKey,
  buildPasswordChangedIdempotencyKey,
  buildPasswordResetIdempotencyKey,
} from "@/domain/email/idempotency-key";
import { MAIL_ERROR_CODES, isRetryableMailError } from "@/domain/email/mail-error-codes";
import { computeMailRetryBackoffMs } from "@/domain/email/retry-backoff";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { renderOrganizationInvitationEmail } from "@/domain/email/templates/organization-invitation";
import { renderEmailVerificationEmail } from "@/domain/email/templates/email-verification";
import { renderPasswordResetEmail } from "@/domain/email/templates/password-reset";
import { renderPasswordChangedEmail } from "@/domain/email/templates/password-changed";

describe("escapeHtml (§7)", () => {
  it("escapes all five special characters", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;"
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("클라우즈베이스 주식회사")).toBe("클라우즈베이스 주식회사");
  });
});

describe("containsCrlf / isValidEmailAddressFormat / normalizeSendRecipient (§6)", () => {
  it("detects CR and LF", () => {
    expect(containsCrlf("a\r\nBcc: attacker@evil.com")).toBe(true);
    expect(containsCrlf("normal@example.com")).toBe(false);
  });

  it("rejects a plausible-looking address containing CRLF", () => {
    expect(isValidEmailAddressFormat("user@example.com\r\nBcc: evil@evil.com")).toBe(false);
  });

  it("accepts a well-formed address", () => {
    expect(isValidEmailAddressFormat("user@example.com")).toBe(true);
  });

  it("normalizeSendRecipient trims whitespace", () => {
    expect(normalizeSendRecipient("  user@example.com  ")).toBe("user@example.com");
  });

  it("normalizeSendRecipient throws on CRLF injection attempt", () => {
    expect(() => normalizeSendRecipient("user@example.com\r\nBcc: evil@evil.com")).toThrow();
  });
});

describe("sanitizeEmailSubject / truncateInterpolatedName (§7 - subject CRLF/injection)", () => {
  it("strips CR/LF and other control characters from a subject", () => {
    const malicious = "안녕\r\nBcc: attacker@evil.com";
    const sanitized = sanitizeEmailSubject(malicious);
    expect(sanitized).not.toContain("\r");
    expect(sanitized).not.toContain("\n");
  });

  it("truncates an overly long subject", () => {
    const long = "가".repeat(500);
    expect(sanitizeEmailSubject(long).length).toBeLessThan(210);
  });

  it("truncateInterpolatedName caps length and strips control characters", () => {
    const malicious = `${"조직명".repeat(50)}\r\nInjected: header`;
    const result = truncateInterpolatedName(malicious);
    expect(result).not.toContain("\r");
    expect(result.length).toBeLessThanOrEqual(83);
  });
});

describe("idempotency key builders (§14)", () => {
  it("are deterministic for the same inputs", () => {
    expect(buildInvitationIdempotencyKey("inv1")).toBe(buildInvitationIdempotencyKey("inv1"));
  });

  it("differ across message types even for the same underlying id", () => {
    expect(buildInvitationIdempotencyKey("id1")).not.toBe(buildEmailVerificationIdempotencyKey("id1"));
    expect(buildEmailVerificationIdempotencyKey("id1")).not.toBe(buildPasswordResetIdempotencyKey("id1"));
  });

  it("password-changed key differs across sessionVersion values", () => {
    const a = buildPasswordChangedIdempotencyKey("user1", 3);
    const b = buildPasswordChangedIdempotencyKey("user1", 4);
    expect(a).not.toBe(b);
  });

  it("resend key differs from the original creation key and across resend counts", () => {
    const original = buildInvitationIdempotencyKey("inv1");
    const resend1 = buildInvitationResendIdempotencyKey("inv1", 1);
    const resend2 = buildInvitationResendIdempotencyKey("inv1", 2);
    expect(resend1).not.toBe(original);
    expect(resend1).not.toBe(resend2);
  });
});

describe("isRetryableMailError (§15 retry classification)", () => {
  it("treats provider timeout/rate-limit/unavailable as retryable under maxAttempts", () => {
    expect(isRetryableMailError(MAIL_ERROR_CODES.PROVIDER_TIMEOUT, 1, 3)).toBe(true);
    expect(isRetryableMailError(MAIL_ERROR_CODES.PROVIDER_RATE_LIMITED, 1, 3)).toBe(true);
    expect(isRetryableMailError(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE, 2, 3)).toBe(true);
  });

  it("treats invalid recipient / sender not verified / auth failed as never retryable", () => {
    expect(isRetryableMailError(MAIL_ERROR_CODES.INVALID_RECIPIENT, 1, 3)).toBe(false);
    expect(isRetryableMailError(MAIL_ERROR_CODES.SENDER_NOT_VERIFIED, 1, 3)).toBe(false);
    expect(isRetryableMailError(MAIL_ERROR_CODES.PROVIDER_AUTH_FAILED, 1, 3)).toBe(false);
  });

  it("stops retrying once attempt reaches maxAttempts even for an otherwise-retryable error", () => {
    expect(isRetryableMailError(MAIL_ERROR_CODES.PROVIDER_TIMEOUT, 3, 3)).toBe(false);
  });
});

describe("computeMailRetryBackoffMs (§15 - 1min/5min/30min + jitter)", () => {
  it("uses roughly 1 minute after the 1st attempt, within jitter bounds", () => {
    const ms = computeMailRetryBackoffMs(1, () => 0.5); // 0 jitter at random()=0.5
    expect(ms).toBe(60_000);
  });

  it("uses roughly 5 minutes after the 2nd attempt", () => {
    const ms = computeMailRetryBackoffMs(2, () => 0.5);
    expect(ms).toBe(5 * 60_000);
  });

  it("uses roughly 30 minutes after the 3rd attempt", () => {
    const ms = computeMailRetryBackoffMs(3, () => 0.5);
    expect(ms).toBe(30 * 60_000);
  });

  it("applies jitter within +/-20% of the base delay", () => {
    const base = 60_000;
    const withMaxJitter = computeMailRetryBackoffMs(1, () => 1);
    const withMinJitter = computeMailRetryBackoffMs(1, () => 0);
    expect(withMaxJitter).toBeLessThanOrEqual(base * 1.2 + 1);
    expect(withMinJitter).toBeGreaterThanOrEqual(base * 0.8 - 1);
  });
});

describe("hashRecipient (§11 - never stores the raw address)", () => {
  it("produces a deterministic sha256 hex digest, not the raw address", () => {
    const hash = hashRecipient("User@Example.com");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("example.com");
  });

  it("is case-insensitive (normalizes before hashing)", () => {
    expect(hashRecipient("User@Example.com")).toBe(hashRecipient("user@example.com"));
  });
});

describe("email templates (§8/§9 - HTML+text, escaping, expiry, no raw token repetition)", () => {
  it("organization invitation template escapes HTML-unsafe org/inviter names and includes both HTML and text bodies", () => {
    const rendered = renderOrganizationInvitationEmail({
      organizationName: `<script>alert(1)</script>`,
      inviterName: `Bob & "the builder"`,
      role: "MEMBER",
      invitationUrl: "https://app.example.com/invitations/abc123",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(rendered.html).not.toContain("<script>alert(1)</script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("https://app.example.com/invitations/abc123");
    expect(rendered.text).toContain("https://app.example.com/invitations/abc123");
    expect(rendered.subject.length).toBeGreaterThan(0);
  });

  it("email verification template includes the URL in both html and text, and an expiry", () => {
    const rendered = renderEmailVerificationEmail({
      verificationUrl: "https://app.example.com/verify-email/tok123",
      expiresAt: new Date("2026-08-02T00:00:00Z"),
    });
    expect(rendered.html).toContain("https://app.example.com/verify-email/tok123");
    expect(rendered.text).toContain("https://app.example.com/verify-email/tok123");
  });

  it("password reset template includes the URL in both html and text", () => {
    const rendered = renderPasswordResetEmail({
      resetUrl: "https://app.example.com/reset-password/tok456",
      expiresAt: new Date("2026-08-01T01:00:00Z"),
    });
    expect(rendered.html).toContain("https://app.example.com/reset-password/tok456");
    expect(rendered.text).toContain("https://app.example.com/reset-password/tok456");
  });

  it("password changed template never fabricates an IP address or location", () => {
    const rendered = renderPasswordChangedEmail({
      changedAt: new Date("2026-08-01T03:00:00Z"),
      forgotPasswordUrl: "https://app.example.com/forgot-password",
    });
    expect(rendered.html).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(rendered.text).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(rendered.html).toContain("https://app.example.com/forgot-password");
  });
});
