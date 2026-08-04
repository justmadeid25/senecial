import { describe, expect, it } from "vitest";

import { loadEmailConfig, resolveEmailConfig, validateEmailConfig } from "@/lib/config/email";
import { classifyPostmarkError } from "@/server/services/email/mail-error";
import { classifyMailSendError, MailProviderError } from "@/server/services/email/mail-provider-error";
import { MAIL_ERROR_CODES } from "@/domain/email/mail-error-codes";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("loadEmailConfig / validateEmailConfig / resolveEmailConfig (§5/§6)", () => {
  it("loadEmailConfig never throws for a completely empty environment", () => {
    const config = loadEmailConfig(env({}));
    expect(config.fromAddress).toBeUndefined();
    expect(config.fromName).toBe("ClauseBase");
  });

  it("validateEmailConfig fails when EMAIL_FROM_ADDRESS is missing", () => {
    const result = validateEmailConfig({});
    expect(result.valid).toBe(false);
  });

  it("validateEmailConfig fails on a malformed from-address", () => {
    const result = validateEmailConfig({ fromAddress: "not-an-email" });
    expect(result.valid).toBe(false);
  });

  it("validateEmailConfig fails when fromName contains CRLF (header injection)", () => {
    const result = validateEmailConfig({
      fromAddress: "noreply@example.com",
      fromName: "ClauseBase\r\nBcc: evil@evil.com",
    });
    expect(result.valid).toBe(false);
  });

  it("validateEmailConfig fails on a malformed reply-to address", () => {
    const result = validateEmailConfig({ fromAddress: "noreply@example.com", replyTo: "not valid" });
    expect(result.valid).toBe(false);
  });

  it("validateEmailConfig fails when provider=postmark but POSTMARK_SERVER_TOKEN is unset", () => {
    const result = validateEmailConfig({ fromAddress: "noreply@example.com", provider: "postmark" });
    expect(result.valid).toBe(false);
  });

  it("validateEmailConfig passes for a fully valid postmark config", () => {
    const result = validateEmailConfig({
      fromAddress: "noreply@example.com",
      fromName: "ClauseBase",
      provider: "postmark",
      postmarkServerToken: "test-token",
    });
    expect(result.valid).toBe(true);
  });

  it("resolveEmailConfig throws a joined error message when config is incomplete", () => {
    expect(() => resolveEmailConfig(env({}))).toThrow(/EMAIL_FROM_ADDRESS/);
  });

  it("resolveEmailConfig never leaks POSTMARK_SERVER_TOKEN's value into its error", () => {
    try {
      resolveEmailConfig(env({ POSTMARK_SERVER_TOKEN: "super-secret-token-must-never-leak" }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-token-must-never-leak");
    }
  });

  it("resolveEmailConfig returns a fully-typed config for a valid environment", () => {
    const config = resolveEmailConfig(
      env({
        EMAIL_PROVIDER: "postmark",
        EMAIL_FROM_ADDRESS: "noreply@example.com",
        POSTMARK_SERVER_TOKEN: "test-token",
      })
    );
    expect(config.fromAddress).toBe("noreply@example.com");
    expect(config.provider).toBe("postmark");
  });
});

describe("classifyPostmarkError (§16 - safe error classification)", () => {
  it("maps HTTP 401 to PROVIDER_AUTH_FAILED", () => {
    expect(classifyPostmarkError({ httpStatus: 401 })).toBe(MAIL_ERROR_CODES.PROVIDER_AUTH_FAILED);
  });

  it("maps HTTP 429 to PROVIDER_RATE_LIMITED", () => {
    expect(classifyPostmarkError({ httpStatus: 429 })).toBe(MAIL_ERROR_CODES.PROVIDER_RATE_LIMITED);
  });

  it("maps HTTP 5xx to PROVIDER_UNAVAILABLE", () => {
    expect(classifyPostmarkError({ httpStatus: 503 })).toBe(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE);
  });

  it("maps a timeout to PROVIDER_TIMEOUT regardless of other fields", () => {
    expect(classifyPostmarkError({ isTimeout: true, httpStatus: 500 })).toBe(MAIL_ERROR_CODES.PROVIDER_TIMEOUT);
  });

  it("maps Postmark ErrorCode 300/406 to INVALID_RECIPIENT", () => {
    expect(classifyPostmarkError({ httpStatus: 422, body: { ErrorCode: 300 } })).toBe(
      MAIL_ERROR_CODES.INVALID_RECIPIENT
    );
    expect(classifyPostmarkError({ httpStatus: 422, body: { ErrorCode: 406 } })).toBe(
      MAIL_ERROR_CODES.INVALID_RECIPIENT
    );
  });

  it("maps Postmark ErrorCode 400 to SENDER_NOT_VERIFIED", () => {
    expect(classifyPostmarkError({ httpStatus: 422, body: { ErrorCode: 400 } })).toBe(
      MAIL_ERROR_CODES.SENDER_NOT_VERIFIED
    );
  });
});

describe("classifyMailSendError (§16 - never forwards the raw error message)", () => {
  it("extracts the code from a MailProviderError", () => {
    const { errorCode } = classifyMailSendError(
      new MailProviderError(MAIL_ERROR_CODES.INVALID_RECIPIENT, "internal detail with secret@host.internal")
    );
    expect(errorCode).toBe(MAIL_ERROR_CODES.INVALID_RECIPIENT);
  });

  it("never includes the original MailProviderError message text in its own safe errorMessage", () => {
    const { errorMessage } = classifyMailSendError(
      new MailProviderError(MAIL_ERROR_CODES.PROVIDER_AUTH_FAILED, "Authorization: Bearer sk_live_abc123")
    );
    expect(errorMessage).not.toContain("sk_live_abc123");
  });

  it("falls back to PROVIDER_UNAVAILABLE for an unrecognized error type", () => {
    const { errorCode } = classifyMailSendError(new Error("some unexpected bug"));
    expect(errorCode).toBe(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE);
  });
});
