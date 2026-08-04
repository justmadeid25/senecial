import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { purgeContract } from "@/features/retention/server/purge-contract";
import { scanPurgeCandidates } from "@/features/retention/server/scan-purge-candidates";
import { purgeSimpleEntities } from "@/features/retention/server/purge-simple-entities";
import { prisma } from "@/server/db/client";
import { generateStorageKey } from "@/server/storage/key-generator";
import { getStorageDriver } from "@/server/storage";

const TEST_EMAIL_DOMAIN = "retention-purge-test.local";
const DAY_MS = 24 * 60 * 60 * 1000;

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Retention Purge Test Org A", slug: `retention-purge-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Retention Purge Test Org B", slug: `retention-purge-test-b-${Date.now()}` },
  });
  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  ownerB = await prisma.user.create({
    data: {
      name: "Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.dataPurgeJob.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

async function createSoftDeletedContract(deletedDaysAgo: number, orgId: string, userId: string) {
  const created = await createContract({
    userId,
    organizationId: orgId,
    input: { title: "Purge 대상 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false },
  });
  const deletedAt = new Date(Date.now() - deletedDaysAgo * DAY_MS);
  await prisma.contract.update({ where: { id: created.id }, data: { deletedAt } });
  return created.id;
}

describe("purgeContract (§6 - contract purge ordering, idempotency, physical file handling)", () => {
  it("is not eligible for a live (non-deleted) contract", async () => {
    const created = await createContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { title: "살아있는 계약", contractType: "NDA", status: "ACTIVE", autoRenewal: false },
    });
    const outcome = await purgeContract(created.id, new Date());
    expect(outcome.status).toBe("not_eligible");
  });

  it("is not eligible before the retention window elapses", async () => {
    const contractId = await createSoftDeletedContract(5, orgA.id, ownerA.id);
    const outcome = await purgeContract(contractId, new Date());
    expect(outcome.status).toBe("not_eligible");

    const stillThere = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(stillThere).not.toBeNull();
  });

  it("purges a contract, its physical files, and every cascaded child row - then is idempotent on retry", async () => {
    const contractId = await createSoftDeletedContract(45, orgA.id, ownerA.id);

    const storageKey = generateStorageKey(orgA.id, ".pdf");
    const storageDriver = getStorageDriver();
    await storageDriver.put({ key: storageKey, data: Buffer.from("purge test file"), mimeType: "application/pdf" });

    const file = await prisma.contractFile.create({
      data: {
        organizationId: orgA.id,
        contractId,
        uploadedById: ownerA.id,
        originalName: "purge-test.pdf",
        storageKey,
        mimeType: "application/pdf",
        size: 16,
        checksum: "irrelevant-checksum",
      },
    });

    const now = new Date();
    const outcome = await purgeContract(contractId, now);
    expect(outcome.status).toBe("purged");

    const contractRow = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(contractRow).toBeNull();

    const fileRow = await prisma.contractFile.findUnique({ where: { id: file.id } });
    expect(fileRow).toBeNull();

    await expect(storageDriver.getBuffer(storageKey)).rejects.toBeDefined();

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: orgA.id, entityType: "Contract", entityId: contractId, action: "CONTRACT_PURGED" },
    });
    expect(auditLog).not.toBeNull();
    expect(JSON.stringify(auditLog?.metadata)).not.toContain("purge-test.pdf");
    expect(JSON.stringify(auditLog?.metadata)).not.toContain(storageKey);

    // idempotent retry
    const secondOutcome = await purgeContract(contractId, now);
    expect(secondOutcome.status).toBe("already_gone");
  });
});

describe("scanPurgeCandidates (§7 - dry-run writes nothing, register is idempotent)", () => {
  it("register:false never writes a DataPurgeJob row", async () => {
    const contractId = await createSoftDeletedContract(40, orgB.id, ownerB.id);

    const before = await prisma.dataPurgeJob.count({ where: { entityId: contractId } });
    expect(before).toBe(0);

    await scanPurgeCandidates(new Date(), false);

    const after = await prisma.dataPurgeJob.count({ where: { entityId: contractId } });
    expect(after).toBe(0);

    await prisma.contract.delete({ where: { id: contractId } });
  });

  it("register:true is idempotent - running it twice creates exactly one DataPurgeJob row", async () => {
    const contractId = await createSoftDeletedContract(40, orgB.id, ownerB.id);

    await scanPurgeCandidates(new Date(), true);
    await scanPurgeCandidates(new Date(), true);

    const jobs = await prisma.dataPurgeJob.findMany({ where: { entityId: contractId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("PENDING");

    await prisma.dataPurgeJob.deleteMany({ where: { entityId: contractId } });
    await prisma.contract.delete({ where: { id: contractId } });
  });

  it("counts contracts scoped correctly across organizations (org isolation)", async () => {
    const contractIdA = await createSoftDeletedContract(60, orgA.id, ownerA.id);
    const contractIdB = await createSoftDeletedContract(60, orgB.id, ownerB.id);

    const summary = await scanPurgeCandidates(new Date(), false);
    expect(summary.contracts.eligibleCount).toBeGreaterThanOrEqual(2);
    expect(summary.contracts.organizationCount).toBeGreaterThanOrEqual(2);

    await prisma.contract.deleteMany({ where: { id: { in: [contractIdA, contractIdB] } } });
  });
});

describe("purgeSimpleEntities (§5 - direct deleteMany for invitations/notifications/terminally-failed jobs)", () => {
  it("deletes an invitation past retention that was never accepted or revoked", async () => {
    const oldInvitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgA.id,
        email: `old-invite@${TEST_EMAIL_DOMAIN}`,
        tokenHash: `hash-${Date.now()}-${Math.random()}`,
        invitedById: ownerA.id,
        expiresAt: new Date(Date.now() - 200 * DAY_MS),
      },
    });

    const result = await purgeSimpleEntities(new Date());
    expect(result.invitationsDeleted).toBeGreaterThanOrEqual(1);

    const stillThere = await prisma.organizationInvitation.findUnique({ where: { id: oldInvitation.id } });
    expect(stillThere).toBeNull();
  });

  it("never deletes a still-pending, not-yet-expired invitation", async () => {
    const liveInvitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgA.id,
        email: `live-invite@${TEST_EMAIL_DOMAIN}`,
        tokenHash: `hash-live-${Date.now()}-${Math.random()}`,
        invitedById: ownerA.id,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });

    await purgeSimpleEntities(new Date());

    const stillThere = await prisma.organizationInvitation.findUnique({ where: { id: liveInvitation.id } });
    expect(stillThere).not.toBeNull();

    await prisma.organizationInvitation.delete({ where: { id: liveInvitation.id } });
  });

  it("deletes an old notification past retention", async () => {
    const oldNotification = await prisma.notification.create({
      data: {
        organizationId: orgA.id,
        type: "EXPIRATION_30D",
        title: "테스트 알림",
        message: "보존 기간 테스트용",
        eventKey: `retention-test-${Date.now()}-${Math.random()}`,
        scheduledFor: new Date(Date.now() - 400 * DAY_MS),
        createdAt: new Date(Date.now() - 400 * DAY_MS),
      },
    });

    const result = await purgeSimpleEntities(new Date());
    expect(result.notificationsDeleted).toBeGreaterThanOrEqual(1);

    const stillThere = await prisma.notification.findUnique({ where: { id: oldNotification.id } });
    expect(stillThere).toBeNull();
  });
});
