import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { requestEmailVerification } from "@/features/account-security/server/request-email-verification";
import { verifyEmail } from "@/features/account-security/server/verify-email";
import { requestPasswordReset } from "@/features/account-security/server/request-password-reset";
import { resetPassword } from "@/features/account-security/server/reset-password";
import { generateSecurityToken, hashSecurityToken } from "@/server/auth/security-token";
import {
  createEmailVerificationToken,
  findEmailVerificationTokenByHash,
} from "@/server/repositories/email-verification-token-repository";
import {
  createPasswordResetToken,
  findPasswordResetTokenByHash,
} from "@/server/repositories/password-reset-token-repository";
import { passwordHasher } from "@/server/auth/password-hasher";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "account-security-test.local";
const HOUR_MS = 60 * 60 * 1000;

let org: { id: string };
let user: { id: string; email: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  org = await prisma.organization.create({
    data: { name: "Account Security Test Org", slug: `account-security-test-${Date.now()}` },
  });
  user = await prisma.user.create({
    data: {
      name: "Test User",
      email: `user@${TEST_EMAIL_DOMAIN}`,
      passwordHash: await passwordHasher.hash("original-password-123"),
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
});

describe("email verification tokens (§19/§47)", () => {
  it("stores only the token hash, never the plaintext", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    const stored = await findEmailVerificationTokenByHash(tokenHash);
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("verifyEmail succeeds with a valid token and marks emailVerifiedAt", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    const result = await verifyEmail(token);
    expect(result.email).toBe(user.email);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerifiedAt).not.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 1000) });

    await expect(verifyEmail(token)).rejects.toThrow();
  });

  it("rejects a reused (already-used) token", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createEmailVerificationToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    await verifyEmail(token);
    await expect(verifyEmail(token)).rejects.toThrow();
  });

  it("rejects an unknown/invalid token", async () => {
    await expect(verifyEmail("not-a-real-token")).rejects.toThrow();
  });

  it("requestEmailVerification is a no-op for an already-verified user", async () => {
    const verifiedUser = await prisma.user.create({
      data: {
        name: "Already Verified",
        email: `already-verified@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        emailVerifiedAt: new Date(),
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestEmailVerification(verifiedUser.id);

    const tokenCount = await prisma.emailVerificationToken.count({ where: { userId: verifiedUser.id } });
    expect(tokenCount).toBe(0);
  });

  it("requestEmailVerification invalidates a previously issued, still-unused token", async () => {
    const freshUser = await prisma.user.create({
      data: {
        name: "Fresh User",
        email: `fresh@${TEST_EMAIL_DOMAIN}`,
        passwordHash: "irrelevant",
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestEmailVerification(freshUser.id);
    const firstToken = await prisma.emailVerificationToken.findFirst({ where: { userId: freshUser.id } });
    expect(firstToken?.usedAt).toBeNull();

    await requestEmailVerification(freshUser.id);

    const firstAfterSecondRequest = await prisma.emailVerificationToken.findUnique({
      where: { id: firstToken!.id },
    });
    expect(firstAfterSecondRequest?.usedAt).not.toBeNull();
  });
});

describe("password reset (§18/§20/§22/§47)", () => {
  it("stores only the token hash, never the plaintext", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    const stored = await findPasswordResetTokenByHash(tokenHash);
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("succeeds with a valid token, updates the password hash, and bumps sessionVersion", async () => {
    const before = await prisma.user.findUnique({ where: { id: user.id } });
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    await resetPassword({ token, password: "new-password-456", confirmPassword: "new-password-456" });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    expect(after?.sessionVersion).toBe((before?.sessionVersion ?? 0) + 1);

    const isNewPasswordValid = await passwordHasher.verify("new-password-456", after!.passwordHash);
    expect(isNewPasswordValid).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 1000) });

    await expect(
      resetPassword({ token, password: "another-password-789", confirmPassword: "another-password-789" })
    ).rejects.toThrow();
  });

  it("rejects a reused (already-used) token", async () => {
    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });

    await resetPassword({ token, password: "first-use-password-1", confirmPassword: "first-use-password-1" });
    await expect(
      resetPassword({ token, password: "second-use-password-2", confirmPassword: "second-use-password-2" })
    ).rejects.toThrow();
  });

  it("requestPasswordReset resolves without throwing for a non-existent email (§18 account enumeration prevention)", async () => {
    await expect(
      requestPasswordReset({ email: `does-not-exist-${Date.now()}@${TEST_EMAIL_DOMAIN}` })
    ).resolves.toBeUndefined();
  });

  it("requestPasswordReset creates a token for an existing account and invalidates the previous one", async () => {
    const resetUser = await prisma.user.create({
      data: {
        name: "Reset Flow User",
        email: `reset-flow@${TEST_EMAIL_DOMAIN}`,
        passwordHash: await passwordHasher.hash("initial-password-000"),
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    await requestPasswordReset({ email: resetUser.email });
    const firstToken = await prisma.passwordResetToken.findFirst({ where: { userId: resetUser.id } });
    expect(firstToken).not.toBeNull();
    expect(firstToken?.usedAt).toBeNull();

    await requestPasswordReset({ email: resetUser.email });
    const firstAfterSecondRequest = await prisma.passwordResetToken.findUnique({ where: { id: firstToken!.id } });
    expect(firstAfterSecondRequest?.usedAt).not.toBeNull();
  });

  it("never records the token or password in AuditLog metadata", async () => {
    const auditUser = await prisma.user.create({
      data: {
        name: "Audit Check User",
        email: `audit-check@${TEST_EMAIL_DOMAIN}`,
        passwordHash: await passwordHasher.hash("audit-initial-pw-000"),
        memberships: { create: { organizationId: org.id, role: MembershipRole.MEMBER } },
      },
    });

    const token = generateSecurityToken();
    const tokenHash = hashSecurityToken(token);
    await createPasswordResetToken({ userId: auditUser.id, tokenHash, expiresAt: new Date(Date.now() + HOUR_MS) });
    await resetPassword({ token, password: "audit-new-password-999", confirmPassword: "audit-new-password-999" });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "User", entityId: auditUser.id, action: "PASSWORD_RESET_COMPLETED" },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("audit-new-password-999");
  });
});
