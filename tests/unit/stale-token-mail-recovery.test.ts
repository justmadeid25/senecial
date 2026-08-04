import { describe, expect, it } from "vitest";

import {
  buildEmailVerificationIdempotencyKey,
  buildInvitationIdempotencyKey,
  buildInvitationResendIdempotencyKey,
  buildPasswordResetIdempotencyKey,
  parseTokenMailEntityId,
} from "@/domain/email/idempotency-key";
import { isRetryableMailError, MAIL_ERROR_CODES } from "@/domain/email/mail-error-codes";
import { isTokenMailMessageType, TOKEN_MAIL_MESSAGE_TYPES } from "@/domain/email/token-mail-types";
import { TRANSACTIONAL_MESSAGE_TYPES } from "@/domain/email/message-types";
import { WORKER_HANDLED_MESSAGE_TYPES } from "@/domain/email/worker-handled-message-types";

describe("parseTokenMailEntityId (Phase 10C §9)", () => {
  it("recovers the invitation id from an initial-send idempotency key", () => {
    expect(parseTokenMailEntityId(buildInvitationIdempotencyKey("inv-1"))).toBe("inv-1");
  });

  it("recovers the same invitation id regardless of resendCount", () => {
    expect(parseTokenMailEntityId(buildInvitationResendIdempotencyKey("inv-1", 3))).toBe("inv-1");
  });

  it("recovers the email verification token id", () => {
    expect(parseTokenMailEntityId(buildEmailVerificationIdempotencyKey("evt-1"))).toBe("evt-1");
  });

  it("recovers the password reset token id", () => {
    expect(parseTokenMailEntityId(buildPasswordResetIdempotencyKey("prt-1"))).toBe("prt-1");
  });

  it("returns null for a malformed key with no second segment", () => {
    expect(parseTokenMailEntityId("not-a-real-key")).toBeNull();
  });
});

describe("TOKEN_MAIL_MESSAGE_TYPES (§8)", () => {
  it("contains exactly the three token-bearing message types", () => {
    expect([...TOKEN_MAIL_MESSAGE_TYPES].sort()).toEqual(
      [
        TRANSACTIONAL_MESSAGE_TYPES.ORGANIZATION_INVITATION,
        TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION,
        TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_RESET,
      ].sort()
    );
  });

  it("never overlaps with WORKER_HANDLED_MESSAGE_TYPES - a token mail must never be claimable by the async worker", () => {
    for (const type of TOKEN_MAIL_MESSAGE_TYPES) {
      expect(WORKER_HANDLED_MESSAGE_TYPES).not.toContain(type);
    }
  });

  it("isTokenMailMessageType agrees with the list", () => {
    expect(isTokenMailMessageType(TRANSACTIONAL_MESSAGE_TYPES.EMAIL_VERIFICATION)).toBe(true);
    expect(isTokenMailMessageType(TRANSACTIONAL_MESSAGE_TYPES.PASSWORD_CHANGED)).toBe(false);
  });
});

describe("TOKEN_REISSUE_REQUIRED (§9)", () => {
  it("is never retryable - a cancelled stale row must never be picked back up by ordinary retry logic", () => {
    expect(isRetryableMailError(MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED, 0, 3)).toBe(false);
  });
});
