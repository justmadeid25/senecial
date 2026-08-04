import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { MAX_STORAGE_DELETE_ATTEMPTS } from "@/domain/contract-files/reconciliation-policy";
import { createContract } from "@/features/contracts/server/create-contract";
import { deleteContractFile } from "@/features/contract-files/server/delete-contract-file";
import { reconcileDeletedFiles } from "@/features/contract-files/server/reconcile-deleted-files";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { prisma } from "@/server/db/client";
import { getStorageDriver } from "@/server/storage";

const TEST_EMAIL_DOMAIN = "file-reconciliation-test.local";

const PDF_BYTES = Buffer.from("%PDF-1.7\n%reconciliation test\n1 0 obj\n", "latin1");

let orgA: { id: string };
let ownerA: { id: string };
let contractA: { id: string };

const createdContractIds: string[] = [];
const createdFileIds: string[] = [];
const createdStorageKeys: string[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "File Reconciliation Test Org", slug: `file-reconciliation-test-${Date.now()}` },
  });
  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });

  const contract = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: {
      title: "재조정 테스트 계약",
      contractType: "SERVICE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
  contractA = { id: contract.id };
  createdContractIds.push(contract.id);
});

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContractIds } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: ownerA.id } });
  await prisma.organization.deleteMany({ where: { id: orgA.id } });
});

describe("deleteContractFile / physical delete failure recording", () => {
  it("records a reconciliation candidate when the physical delete fails, then a later retry succeeds", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "reconcile-me.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    createdFileIds.push(uploaded.id);
    const originalRow = await prisma.contractFile.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    const realStorageKey = originalRow.storageKey;
    createdStorageKeys.push(realStorageKey);

    // Corrupt the DB row's storageKey to something that fails
    // LocalStorageDriver's key-pattern validation, forcing the physical
    // delete step inside deleteContractFile() to throw - without touching
    // the actual physical file, which stays on disk under the real key.
    await prisma.contractFile.update({
      where: { id: uploaded.id },
      data: { storageKey: "not-a-valid-storage-key" },
    });

    await deleteContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      fileId: uploaded.id,
    });

    const afterFailedDelete = await prisma.contractFile.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(afterFailedDelete.deletedAt).not.toBeNull(); // DB soft-delete still succeeded
    expect(afterFailedDelete.storageDeletedAt).toBeNull();
    expect(afterFailedDelete.storageDeleteAttempts).toBe(1);
    expect(afterFailedDelete.storageDeleteError).not.toBeNull();
    expect(afterFailedDelete.storageDeleteError).not.toContain(" at "); // no stack trace

    // Restore the real storageKey (simulating the transient condition
    // clearing) and confirm the next reconciliation pass finds and fixes it.
    await prisma.contractFile.update({
      where: { id: uploaded.id },
      data: { storageKey: realStorageKey },
    });

    const storageDriver = getStorageDriver();
    expect(await storageDriver.exists(realStorageKey)).toBe(true);

    const result = await reconcileDeletedFiles();
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    const afterReconcile = await prisma.contractFile.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(afterReconcile.storageDeletedAt).not.toBeNull();
    expect(await storageDriver.exists(realStorageKey)).toBe(false);
  });

  it("treats an already-missing physical file as a successful reconciliation (idempotent)", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "already-gone.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.concat([PDF_BYTES, Buffer.from("already-gone")]),
    });
    createdFileIds.push(uploaded.id);
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdStorageKeys.push(row.storageKey);

    // Manually mark it as soft-deleted with a failed reconciliation state,
    // without actually removing the physical file via the normal delete
    // flow - this simulates "the row says pending reconciliation" directly.
    await prisma.contractFile.update({
      where: { id: uploaded.id },
      data: { deletedAt: new Date(), storageDeleteAttempts: 1, storageDeleteError: "previous failure" },
    });

    const result = await reconcileDeletedFiles();
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    const after = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(after.storageDeletedAt).not.toBeNull();
  });

  it("stops retrying once storageDeleteAttempts reaches the maximum", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "max-attempts.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.concat([PDF_BYTES, Buffer.from("max-attempts")]),
    });
    createdFileIds.push(uploaded.id);
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdStorageKeys.push(row.storageKey);

    await prisma.contractFile.update({
      where: { id: uploaded.id },
      data: {
        deletedAt: new Date(),
        storageDeleteAttempts: MAX_STORAGE_DELETE_ATTEMPTS,
        storageDeleteError: "exhausted",
      },
    });

    await reconcileDeletedFiles();

    const after = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    // Untouched - findReconcilableContractFiles excludes rows at/above the max.
    expect(after.storageDeletedAt).toBeNull();
    expect(after.storageDeleteAttempts).toBe(MAX_STORAGE_DELETE_ATTEMPTS);
  });
});
