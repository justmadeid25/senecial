import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MAIL_ERROR_CODES } from "@/domain/email/mail-error-codes";
import { MailProviderError } from "@/server/services/email/mail-provider-error";

let passwordChangedBehavior: "succeed" | "retryable-fail" | "permanent-fail" = "succeed";

// Only sendPasswordChangedNotice is overridden - the other two methods
// delegate to the real DevelopmentAccountSecurityMailer instance so the
// "atomic creation" tests below (which use requestEmailVerification /
// requestPasswordReset unmodified) keep exercising real behavior.
vi.mock("@/server/services/account-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/account-security")>();
  return {
    ...actual,
    getAccountSecurityMailer: () => {
      const real = actual.getAccountSecurityMailer();
      return {
        sendEmailVerification: real.sendEmailVerification.bind(real),
        sendPasswordReset: real.sendPasswordReset.bind(real),
        sendPasswordChangedNotice: async (input: { to: string; idempotencyKey: string }) => {
          if (passwordChangedBehavior === "retryable-fail") {
            throw new MailProviderError(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE, "simulated transient failure");
          }
          if (passwordChangedBehavior === "permanent-fail") {
            throw new MailProviderError(MAIL_ERROR_CODES.INVALID_RECIPIENT, "simulated permanent failure");
          }
          return real.sendPasswordChangedNotice(input);
        },
      };
    },
  };
});

const { MembershipRole, MailDeliveryStatus } = await import("@/generated/prisma/enums");
const { createInvitation } = await import("@/features/members/server/create-invitation");
const { requestEmailVerification } = await import("@/features/account-security/server/request-email-verification");
const { requestPasswordReset } = await import("@/features/account-security/server/request-password-reset");
const { resetPassword } = await import("@/features/account-security/server/reset-password");
const { generateSecurityToken, hashSecurityToken } = await import("@/server/auth/security-token");
const { createPasswordResetToken } = await import("@/server/repositories/password-reset-token-repository");
const { hashRecipient } = await import("@/domain/email/recipient-hash");
const {
  claimNextPendingMailDelivery,
  enqueuePendingMailDelivery,
} = await import("@/server/repositories/mail-delivery-repository");
const { processNextMailDelivery } = await import("@/features/mail/server/process-next-mail-delivery");
const { passwordHasher } = await import("@/server/auth/password-hasher");
const { prisma } = await import("@/server/db/client");

const TEST_EMAIL_DOMAIN = "mail-delivery-test.local";
const HOUR_MS = 60 * 60 * 1000;

let org: { id: string };
let owner: { id: string; email: string };

beforeAll(async () => {
  // Organizations first (see afterAll's comment) - a prior interrupted run
  // could otherwise leave invitation rows that RESTRICT this cleanup.
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "mail-delivery-test-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Mail Delivery Test Org", slug: `mail-delivery-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Mail Delivery Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: await passwordHasher.hash("original-password-123"),
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  // Organization first - cascades away OrganizationInvitation rows, which
  // otherwise RESTRICT deleting the User referenced by invitedById.
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

/** Test-isolation helper - claimNextPendingMailDelivery() is table-wide (oldest scheduledFor first, matching real worker behavior), so any PENDING row left over from an earlier test in this file must be drained before a later test can assert on its OWN freshly-created row being the one claimed. */
async function drainPendingMailDeliveries(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const result = await processNextMailDelivery("drain-worker");
    if (!result.processed) {
      return;
    }
  }
}

describe("atomic MailDelivery creation (§27 items 1-4)", () => {
  it("creating an invitation atomically creates a terminal MailDelivery row", async () => {
    const invitation = await createInvitation({
      userId: owner.id,
      organizationId: org.id,
      input: { email: `invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`, role: "MEMBER" },
    });

    const delivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `organization-invitation:${invitation.id}` },
    });
    expect(delivery).not.toBeNull();
    expect(delivery?.organizationId).toBe(org.id);
    expect([MailDeliveryStatus.SENT, MailDeliveryStatus.FAILED]).toContain(delivery?.status);
  });

  it("requesting email verification atomically creates a MailDelivery row", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Verify Me",
        email: `verify-me-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestEmailVerification(user.id);

    const token = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id } });
    expect(token).not.toBeNull();
    const delivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `email-verification:${token!.id}` },
    });
    expect(delivery).not.toBeNull();
    expect(delivery?.userId).toBe(user.id);
  });

  it("requesting a password reset atomically creates a MailDelivery row", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Reset Me",
        email: `reset-me-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestPasswordReset({ email: user.email });

    const token = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(token).not.toBeNull();
    const delivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `password-reset:${token!.id}` },
    });
    expect(delivery).not.toBeNull();
  });

  it("completing a password reset atomically creates a PENDING PASSWORD_CHANGED MailDelivery row", async () => {
    passwordChangedBehavior = "succeed";
    const user = await prisma.user.create({
      data: {
        name: "Changed Me",
        email: `changed-me-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: await passwordHasher.hash("old-password-000"),
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });
    const token = generateSecurityToken();
    await createPasswordResetToken({
      userId: user.id,
      tokenHash: hashSecurityToken(token),
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    await resetPassword({ token, password: "new-password-999", confirmPassword: "new-password-999" });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const delivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `password-changed:${user.id}:${after!.sessionVersion}` },
    });
    expect(delivery).not.toBeNull();
    expect(delivery?.status).toBe(MailDeliveryStatus.PENDING);
    expect(delivery?.messageType).toBe("PASSWORD_CHANGED");
  });
});

describe("duplicate idempotency is blocked (§27 item 5)", () => {
  it("a second enqueue with the same idempotencyKey is a no-op, not a duplicate row", async () => {
    const key = `test-dedup:${Date.now()}`;
    const first = await enqueuePendingMailDelivery({
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient("dedup@example.com"),
      idempotencyKey: key,
    });
    const second = await enqueuePendingMailDelivery({
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient("dedup@example.com"),
      idempotencyKey: key,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const count = await prisma.mailDelivery.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });
});

describe("worker claim (§27 items 6-7)", () => {
  beforeAll(async () => {
    await drainPendingMailDeliveries();
  });

  it("claims a PENDING row and transitions it to SENDING with attempt incremented", async () => {
    const key = `test-claim:${Date.now()}`;
    await enqueuePendingMailDelivery({
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient("claim@example.com"),
      idempotencyKey: key,
    });

    // This test file is serialized against the other queue-claim test
    // files (vitest.config.ts), but a *different* vitest project's
    // integration test (e.g. account-security.test.ts, which enqueues a
    // real PASSWORD_CHANGED row via resetPassword()) could in principle
    // still be running concurrently and insert a row with an OLDER
    // scheduledFor - loop past any such foreign row rather than assuming
    // the very first claim is necessarily this test's own.
    let claimed = null;
    for (let i = 0; i < 20; i++) {
      const result = await claimNextPendingMailDelivery(`worker-1-${i}`);
      if (!result) break;
      if (result.idempotencyKey === key) {
        claimed = result;
        break;
      }
    }
    expect(claimed?.idempotencyKey).toBe(key);
    expect(claimed?.status).toBe(MailDeliveryStatus.SENDING);
    expect(claimed?.attempt).toBe(1);
  });

  it("two concurrent workers racing the same row - exactly one claims it", async () => {
    const key = `test-race:${Date.now()}`;
    await enqueuePendingMailDelivery({
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient("race@example.com"),
      idempotencyKey: key,
    });

    const [a, b] = await Promise.all([
      claimNextPendingMailDelivery("worker-a"),
      claimNextPendingMailDelivery("worker-b"),
    ]);
    const claimedByA = a?.idempotencyKey === key;
    const claimedByB = b?.idempotencyKey === key;
    expect(claimedByA !== claimedByB).toBe(true); // exactly one, never both, never neither
  });
});

describe("processNextMailDelivery outcomes (§27 items 8-11)", () => {
  beforeAll(async () => {
    passwordChangedBehavior = "succeed";
    await drainPendingMailDeliveries();
  });

  afterEach(async () => {
    // A retryable-failure test deliberately leaves its row PENDING (that
    // IS the behavior under test) - drain it with "succeed" behavior so
    // it never leaks into the next test's own claim.
    passwordChangedBehavior = "succeed";
    await drainPendingMailDeliveries();
  });

  it("a successful send transitions the row to SENT", async () => {
    passwordChangedBehavior = "succeed";
    const key = `test-sent:${Date.now()}`;
    await enqueuePendingMailDelivery({
      organizationId: org.id,
      userId: owner.id,
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient(owner.email),
      idempotencyKey: key,
    });

    const result = await processNextMailDelivery("worker-sent");
    expect(result.outcome).toBe("sent");

    const row = await prisma.mailDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row?.status).toBe(MailDeliveryStatus.SENT);
    expect(row?.sentAt).not.toBeNull();
  });

  it("a retryable failure keeps the row PENDING with scheduledFor pushed into the future", async () => {
    passwordChangedBehavior = "retryable-fail";
    const key = `test-retry:${Date.now()}`;
    await enqueuePendingMailDelivery({
      organizationId: org.id,
      userId: owner.id,
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient(owner.email),
      idempotencyKey: key,
    });

    const before = new Date();
    const result = await processNextMailDelivery("worker-retry");
    expect(result.outcome).toBe("retrying");

    const row = await prisma.mailDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row?.status).toBe(MailDeliveryStatus.PENDING);
    expect(row?.attempt).toBe(1);
    expect(row?.errorCode).toBe(MAIL_ERROR_CODES.PROVIDER_UNAVAILABLE);
    expect(row!.scheduledFor.getTime()).toBeGreaterThan(before.getTime());

    passwordChangedBehavior = "succeed";
  });

  it("a permanent (non-retryable) failure marks the row FAILED on the very first attempt", async () => {
    passwordChangedBehavior = "permanent-fail";
    const key = `test-permanent-fail:${Date.now()}`;
    await enqueuePendingMailDelivery({
      organizationId: org.id,
      userId: owner.id,
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient(owner.email),
      idempotencyKey: key,
    });

    const result = await processNextMailDelivery("worker-permanent");
    expect(result.outcome).toBe("failed");

    const row = await prisma.mailDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row?.status).toBe(MailDeliveryStatus.FAILED);
    expect(row?.attempt).toBe(1);
    expect(row?.errorCode).toBe(MAIL_ERROR_CODES.INVALID_RECIPIENT);

    passwordChangedBehavior = "succeed";
  });

  it("exhausting maxAttempts on a retryable error eventually marks the row FAILED with MAX_ATTEMPTS_REACHED", async () => {
    passwordChangedBehavior = "retryable-fail";
    const key = `test-max-attempts:${Date.now()}`;
    await enqueuePendingMailDelivery({
      organizationId: org.id,
      userId: owner.id,
      messageType: "PASSWORD_CHANGED",
      recipientHash: hashRecipient(owner.email),
      idempotencyKey: key,
    });

    let lastResult;
    for (let i = 0; i < 3; i++) {
      // Bypass the real backoff wait for test speed - jump scheduledFor into the past before each re-claim.
      await prisma.mailDelivery.update({ where: { idempotencyKey: key }, data: { scheduledFor: new Date(0) } });
      lastResult = await processNextMailDelivery(`worker-max-${i}`);
    }

    expect(lastResult?.outcome).toBe("failed");
    const row = await prisma.mailDelivery.findUnique({ where: { idempotencyKey: key } });
    expect(row?.status).toBe(MailDeliveryStatus.FAILED);
    expect(row?.attempt).toBe(3);
    expect(row?.errorCode).toBe(MAIL_ERROR_CODES.MAX_ATTEMPTS_REACHED);

    passwordChangedBehavior = "succeed";
  });
});

describe("no sensitive data leaks into MailDelivery (§27 items 12-13)", () => {
  it("never stores the plaintext token or the raw recipient email address", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Leak Check",
        email: `leak-check-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestEmailVerification(user.id);
    const token = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id } });
    const delivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `email-verification:${token!.id}` },
    });

    const serialized = JSON.stringify(delivery);
    expect(serialized).not.toContain(user.email);
    expect(delivery?.recipientHash).toBe(hashRecipient(user.email));
    expect(delivery?.recipientHash).not.toBe(user.email);
  });
});
