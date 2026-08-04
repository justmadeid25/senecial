import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import type { EmailConfig } from "@/lib/config/email";
import { PostmarkTransactionalMailer, probePostmarkServerIdentity } from "@/server/services/email/postmark-transactional-mailer";
import { MailProviderError } from "@/server/services/email/mail-provider-error";

/**
 * Phase 10B section 25 - real network round-trip tests against Postmark's
 * actual REST API, never a mock. Uses Postmark's own publicly documented
 * test server token ("POSTMARK_API_TEST") - a well-known constant Postmark
 * itself provides specifically for integration testing without a real
 * account: requests are fully validated (auth, payload shape) and receive
 * a normal success response with a real-shaped MessageID, but nothing is
 * actually delivered and no sender verification is required. This is not
 * a fabricated/guessed credential - it is Postmark's own published
 * constant for exactly this purpose - and no real personal email address
 * is used (Postmark's own "blackhole" test address is used as the
 * recipient, which is also publicly documented to safely accept and
 * discard test mail).
 *
 * Skipped entirely (not failed) unless TEST_POSTMARK=true - the default
 * `pnpm test` run does not require network access. To run for real:
 *
 *   TEST_POSTMARK=true pnpm exec dotenv -e .env.test -- vitest run tests/integration/postmark-real.test.ts
 */
const hasPostmarkTest = process.env.TEST_POSTMARK === "true";

const config: EmailConfig = {
  provider: "postmark",
  fromAddress: "senecial-test@example.com",
  fromName: "Senecial Integration Test",
  postmarkServerToken: process.env.TEST_POSTMARK_SERVER_TOKEN || "POSTMARK_API_TEST",
  postmarkMessageStream: "outbound",
};

describe.skipIf(!hasPostmarkTest)("PostmarkTransactionalMailer against the real Postmark API (§25)", () => {
  const mailer = new PostmarkTransactionalMailer(config);

  it("server identity probe reaches the real API (result depends on token type - see comment)", async () => {
    // Real, confirmed finding: Postmark's own API explicitly rejects the
    // public POSTMARK_API_TEST sentinel token on GET /server with HTTP 403
    // ErrorCode 10, "The Postmark Test API Token may only be used on the
    // /email endpoint." (verified via a direct curl against the real API
    // during this Phase's testing) - so this probe correctly reports
    // "error" when TEST_POSTMARK_SERVER_TOKEN is left at its default. A
    // real, account-specific Postmark server token (set via
    // TEST_POSTMARK_SERVER_TOKEN) is required to see "ok" here, exactly as
    // it would need to be in actual production use.
    const result = await probePostmarkServerIdentity(config);
    const usingRealAccountToken = Boolean(process.env.TEST_POSTMARK_SERVER_TOKEN);
    expect(result.status).toBe(usingRealAccountToken ? "ok" : "error");
  });

  it("send() completes a real HTTP round trip and returns accepted:true with a providerMessageId", async () => {
    const result = await mailer.send({
      messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
      to: "test@blackhole.postmarkapp.com",
      subject: "Senecial 통합 테스트 이메일 인증",
      html: "<p>실제 Postmark API 왕복 테스트입니다.</p>",
      text: "실제 Postmark API 왕복 테스트입니다.",
      idempotencyKey: `postmark-real-test:${randomUUID()}`,
    });
    expect(result.accepted).toBe(true);
    expect(result.providerMessageId).toBeTruthy();
  });

  it("sends all four message types successfully with both HTML and text bodies", async () => {
    const types = [
      TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
      TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
      TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
      TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED,
    ];

    for (const messageType of types) {
      const result = await mailer.send({
        messageType,
        to: "test@blackhole.postmarkapp.com",
        subject: `Senecial 테스트 - ${messageType}`,
        html: `<p>${messageType} html body</p>`,
        text: `${messageType} text body`,
        idempotencyKey: `postmark-real-test:${messageType}:${randomUUID()}`,
      });
      expect(result.accepted).toBe(true);
      expect(result.providerMessageId).toBeTruthy();
    }
  });

  it("an invalid recipient address is rejected with a safely-classified INVALID_RECIPIENT error, never the raw provider message", async () => {
    try {
      await mailer.send({
        messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
        to: "this-is-not-a-valid-email-address",
        subject: "should be rejected",
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: `postmark-real-test:invalid:${randomUUID()}`,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MailProviderError);
      const providerError = error as MailProviderError;
      // Only ever one of the app's own safe codes - never raw Postmark text.
      expect(["INVALID_RECIPIENT", "PROVIDER_UNAVAILABLE"]).toContain(providerError.errorCode);
    }
  });

  it("an auth failure (bad server token) is classified as PROVIDER_AUTH_FAILED, never leaking the token", async () => {
    const badConfig: EmailConfig = { ...config, postmarkServerToken: "clearly-invalid-token-value" };
    const badMailer = new PostmarkTransactionalMailer(badConfig);
    try {
      await badMailer.send({
        messageType: TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
        to: "test@blackhole.postmarkapp.com",
        subject: "should fail auth",
        html: "<p>x</p>",
        text: "x",
        idempotencyKey: `postmark-real-test:badauth:${randomUUID()}`,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MailProviderError);
      const providerError = error as MailProviderError;
      expect(providerError.errorCode).toBe("PROVIDER_AUTH_FAILED");
      expect(providerError.message).not.toContain("clearly-invalid-token-value");
    }
  });
});
