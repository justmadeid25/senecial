import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildInvitationIdempotencyKey, buildEmailVerificationIdempotencyKey, buildPasswordResetIdempotencyKey } from "@/domain/email/idempotency-key";
import { MAIL_ERROR_CODES } from "@/domain/email/mail-error-codes";
import { hashRecipient } from "@/domain/email/recipient-hash";
import { hashInvitationToken } from "@/server/auth/invitation-token";
import { hashSecurityToken } from "@/server/auth/security-token";

const { MembershipRole, MailDeliveryStatus } = await import("@/generated/prisma/enums");
const { prisma } = await import("@/server/db/client");
const { enqueuePendingMailDelivery } = await import("@/server/repositories/mail-delivery-repository");
const { scanStaleTokenDeliveries } = await import("@/features/mail/server/scan-stale-token-deliveries");
const { recoverStaleTokenDeliveries } = await import("@/features/mail/server/recover-stale-token-deliveries");

const TEST_EMAIL_DOMAIN = "stale-token-recovery-test.local";
const HOUR_MS = 60 * 60 * 1000;
const STALE_MINUTES = 5;

let org: { id: string };
let inviter: { id: string; email: string };

/** Simulates the exact stuck state this feature exists to fix: a token-bearing MailDelivery row created (atomically, inside the originating transaction) but never transitioned past PENDING because the process died before the synchronous inline send ran - see token-mail-types.ts's docstring. `ageMinutes` backdates createdAt directly (bypassing the repository's `now()` default) so the row looks like it has been stuck for that long. */
async function createStalePendingDelivery(params: {
  messageType: string;
  organizationId?: string;
  userId?: string;
  recipientEmail: string;
  idempotencyKey: string;
  ageMinutes: number;
}) {
  const delivery = await enqueuePendingMailDelivery({
    organizationId: params.organizationId,
    userId: params.userId,
    messageType: params.messageType,
    recipientHash: hashRecipient(params.recipientEmail),
    idempotencyKey: params.idempotencyKey,
  });
  if (!delivery) {
    throw new Error("test setup: duplicate idempotencyKey");
  }
  return prisma.mailDelivery.update({
    where: { id: delivery.id },
    data: { createdAt: new Date(Date.now() - params.ageMinutes * 60 * 1000) },
  });
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "stale-token-recovery-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Stale Token Recovery Test Org", slug: `stale-token-recovery-${Date.now()}` },
  });
  inviter = await prisma.user.create({
    data: {
      name: "Stale Recovery Inviter",
      email: `inviter@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("scanStaleTokenDeliveries (§9)", () => {
  it("detects a stale PENDING invitation delivery but not a fresh one", async () => {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        email: `scan-invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: MembershipRole.MEMBER,
        tokenHash: hashInvitationToken(`fake-token-${Date.now()}`),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      ageMinutes: STALE_MINUTES * 2,
    });
    const fresh = await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: `${buildInvitationIdempotencyKey(invitation.id)}:fresh-probe`,
      ageMinutes: 0,
    });

    const result = await scanStaleTokenDeliveries(STALE_MINUTES);

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(stale.id);
    expect(ids).not.toContain(fresh.id);

    // §16 - never the recipient email, token, or URL - only id/messageType/age.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(invitation.email);
    expect(serialized).not.toContain("@");

    await prisma.mailDelivery.deleteMany({ where: { id: { in: [stale.id, fresh.id] } } });
  });
});

describe("recoverStaleTokenDeliveries - invitations (§10)", () => {
  it("dry-run rotates nothing and cancels nothing", async () => {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        email: `dryrun-invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: MembershipRole.MEMBER,
        tokenHash: hashInvitationToken(`fake-token-${Date.now()}`),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    const result = await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: true });
    expect(result.invitationsRotated).toBeGreaterThanOrEqual(1);

    const invitationAfter = await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    const deliveryAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(invitationAfter?.tokenHash).toBe(invitation.tokenHash);
    expect(invitationAfter?.resendCount).toBe(0);
    expect(deliveryAfter?.status).toBe(MailDeliveryStatus.PENDING);
  });

  it("rotates the invitation token, cancels the stale delivery, and enqueues a new one", async () => {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        email: `recover-invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: MembershipRole.MEMBER,
        tokenHash: hashInvitationToken(`fake-token-${Date.now()}`),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false });

    const invitationAfter = await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(invitationAfter?.tokenHash).not.toBe(invitation.tokenHash);
    expect(invitationAfter?.resendCount).toBe(1);

    const staleAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe(MailDeliveryStatus.CANCELLED);
    expect(staleAfter?.errorCode).toBe(MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED);

    const newDelivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: { startsWith: `organization-invitation:${invitation.id}:resend:` } },
    });
    expect(newDelivery).not.toBeNull();
    expect([MailDeliveryStatus.SENT, MailDeliveryStatus.FAILED]).toContain(newDelivery?.status);

    const auditLog = await prisma.auditLog.findFirst({
      where: { action: "STALE_TOKEN_MAIL_INVITATION_RECOVERED", entityId: invitation.id },
    });
    expect(auditLog).not.toBeNull();
  });

  it("cancels (does not rotate) a stale delivery for an already-accepted invitation", async () => {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        email: `already-accepted-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: MembershipRole.MEMBER,
        tokenHash: hashInvitationToken(`fake-token-${Date.now()}`),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
        acceptedAt: new Date(),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    const result = await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false });
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const staleAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe(MailDeliveryStatus.CANCELLED);

    const invitationAfter = await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(invitationAfter?.tokenHash).toBe(invitation.tokenHash); // untouched
  });

  it("two concurrent recovery runs never both rotate the same stale row", async () => {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        email: `race-invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: MembershipRole.MEMBER,
        tokenHash: hashInvitationToken(`fake-token-${Date.now()}`),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
      },
    });
    await createStalePendingDelivery({
      messageType: "ORGANIZATION_INVITATION",
      organizationId: org.id,
      userId: inviter.id,
      recipientEmail: invitation.email,
      idempotencyKey: buildInvitationIdempotencyKey(invitation.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    await Promise.all([
      recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false }),
      recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false }),
    ]);

    const invitationAfter = await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(invitationAfter?.resendCount).toBe(1); // rotated exactly once, never twice
  });
});

describe("recoverStaleTokenDeliveries - email verification (§10)", () => {
  it("rotates the verification token and cancels the stale delivery", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Verify Stale",
        email: `verify-stale-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });
    const token = await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSecurityToken(`fake-verify-token-${Date.now()}`),
        expiresAt: new Date(Date.now() + 24 * HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "EMAIL_VERIFICATION",
      organizationId: org.id,
      userId: user.id,
      recipientEmail: user.email,
      idempotencyKey: buildEmailVerificationIdempotencyKey(token.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    const result = await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false });
    expect(result.verificationsRotated).toBeGreaterThanOrEqual(1);

    const staleAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe(MailDeliveryStatus.CANCELLED);

    const oldToken = await prisma.emailVerificationToken.findUnique({ where: { id: token.id } });
    expect(oldToken?.usedAt).not.toBeNull(); // invalidated, not reused

    const newToken = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id, id: { not: token.id } },
    });
    expect(newToken).not.toBeNull();

    const newDelivery = await prisma.mailDelivery.findFirst({
      where: { idempotencyKey: `email-verification:${newToken!.id}` },
    });
    expect(newDelivery).not.toBeNull();
  });

  it("skips (cancels only) if the user already verified their email", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Already Verified",
        email: `already-verified-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        emailVerifiedAt: new Date(),
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });
    const token = await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSecurityToken(`fake-verify-token-${Date.now()}`),
        expiresAt: new Date(Date.now() + 24 * HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "EMAIL_VERIFICATION",
      organizationId: org.id,
      userId: user.id,
      recipientEmail: user.email,
      idempotencyKey: buildEmailVerificationIdempotencyKey(token.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false });

    const staleAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe(MailDeliveryStatus.CANCELLED);

    const otherTokens = await prisma.emailVerificationToken.count({ where: { userId: user.id, id: { not: token.id } } });
    expect(otherTokens).toBe(0); // no new token minted
  });
});

describe("recoverStaleTokenDeliveries - password reset (§10)", () => {
  it("only cancels the stale delivery - never mints a new PasswordResetToken or sends mail", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Reset Stale",
        email: `reset-stale-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });
    const token = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSecurityToken(`fake-reset-token-${Date.now()}`),
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });
    const stale = await createStalePendingDelivery({
      messageType: "PASSWORD_RESET",
      organizationId: org.id,
      userId: user.id,
      recipientEmail: user.email,
      idempotencyKey: buildPasswordResetIdempotencyKey(token.id),
      ageMinutes: STALE_MINUTES * 2,
    });

    const result = await recoverStaleTokenDeliveries({ staleMinutes: STALE_MINUTES, dryRun: false });
    expect(result.passwordResetsFlagged).toBeGreaterThanOrEqual(1);

    const staleAfter = await prisma.mailDelivery.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe(MailDeliveryStatus.CANCELLED);
    expect(staleAfter?.errorCode).toBe(MAIL_ERROR_CODES.TOKEN_REISSUE_REQUIRED);

    // Never a new token, never a new MailDelivery - §10's "운영자가 임의 재발송하지 않음".
    const tokenCount = await prisma.passwordResetToken.count({ where: { userId: user.id } });
    expect(tokenCount).toBe(1);
    const deliveryCount = await prisma.mailDelivery.count({ where: { userId: user.id, messageType: "PASSWORD_RESET" } });
    expect(deliveryCount).toBe(1);

    const auditLog = await prisma.auditLog.findFirst({
      where: { action: "STALE_TOKEN_MAIL_PASSWORD_RESET_FLAGGED", entityId: stale.id },
    });
    expect(auditLog).not.toBeNull();
  });
});
