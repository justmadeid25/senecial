import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { deleteContractFile } from "@/features/contract-files/server/delete-contract-file";
import { listContractFiles } from "@/features/contract-files/server/list-contract-files";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/server/db/client";
import { getStorageDriver } from "@/server/storage";

const TEST_EMAIL_DOMAIN = "contract-files-test.local";

const PDF_BYTES = Buffer.from("%PDF-1.7\n%test contract file bytes\n1 0 obj\n", "latin1");

function pdfBytesWithMarker(marker: string): Buffer {
  return Buffer.concat([PDF_BYTES, Buffer.from(marker, "utf8")]);
}

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };
let contractA: { id: string };
let contractA2: { id: string };
let contractB: { id: string };

const createdContractIds: string[] = [];
const createdFileStorageKeys: string[] = [];

const baseContractInput = {
  contractType: "SERVICE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
  currency: "KRW",
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Files Test Org A", slug: `files-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Files Test Org B", slug: `files-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  memberA = await prisma.user.create({
    data: {
      name: "Member A",
      email: `member-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
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

  const created = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: { ...baseContractInput, title: "파일 테스트 계약 A" },
  });
  contractA = { id: created.id };
  createdContractIds.push(created.id);

  const created2 = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: { ...baseContractInput, title: "파일 테스트 계약 A2" },
  });
  contractA2 = { id: created2.id };
  createdContractIds.push(created2.id);

  const createdB = await createContract({
    userId: ownerB.id,
    organizationId: orgB.id,
    input: { ...baseContractInput, title: "파일 테스트 계약 B" },
  });
  contractB = { id: createdB.id };
  createdContractIds.push(createdB.id);
});

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContractIds } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("uploadContractFile", () => {
  it("accepts a valid PDF upload from a MEMBER", async () => {
    const result = await uploadContractFile({
      userId: memberA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "계약서.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("upload-success"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: result.id } });
    createdFileStorageKeys.push(row.storageKey);

    expect(result.originalName).toBe("계약서.pdf");
    expect(row.storageKey).not.toContain("계약서");
  });

  it("rejects a disallowed file extension", async () => {
    await expect(
      uploadContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        originalName: "malware.exe",
        mimeType: "application/pdf",
        buffer: pdfBytesWithMarker("bad-extension"),
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a file whose size exceeds the 20MB cap", async () => {
    const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(21 * 1024 * 1024, 0x41)]);
    await expect(
      uploadContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        originalName: "big.pdf",
        mimeType: "application/pdf",
        buffer: oversized,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a file whose content does not match its declared type (spoofed extension/MIME)", async () => {
    await expect(
      uploadContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        originalName: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("this is not actually a pdf file", "utf8"),
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an upload targeting a contract in another organization", async () => {
    await expect(
      uploadContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractB.id,
        originalName: "wrong-org.pdf",
        mimeType: "application/pdf",
        buffer: pdfBytesWithMarker("wrong-org"),
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("blocks a duplicate-checksum upload within the same contract", async () => {
    const buffer = pdfBytesWithMarker("duplicate-within-contract");
    const first = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "first.pdf",
      mimeType: "application/pdf",
      buffer,
    });
    const firstRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: first.id } });
    createdFileStorageKeys.push(firstRow.storageKey);

    await expect(
      uploadContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        originalName: "second-same-content.pdf",
        mimeType: "application/pdf",
        buffer,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same checksum to be uploaded to a different contract", async () => {
    const buffer = pdfBytesWithMarker("duplicate-across-contracts");
    const first = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "contract-a.pdf",
      mimeType: "application/pdf",
      buffer,
    });
    const firstRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: first.id } });
    createdFileStorageKeys.push(firstRow.storageKey);

    const second = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA2.id,
      originalName: "contract-a2.pdf",
      mimeType: "application/pdf",
      buffer,
    });
    const secondRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: second.id } });
    createdFileStorageKeys.push(secondRow.storageKey);

    expect(second.id).not.toBe(first.id);
  });

  it("records a FILE_UPLOADED audit log entry that never contains the storageKey", async () => {
    const result = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "audit-upload.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("audit-upload"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: result.id } });
    createdFileStorageKeys.push(row.storageKey);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: result.id, action: "FILE_UPLOADED" },
    });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.metadata)).not.toContain(row.storageKey);
  });
});

describe("listContractFiles / organization isolation", () => {
  it("org B cannot list org A's contract files - NotFoundError", async () => {
    await expect(
      listContractFiles({ userId: ownerB.id, organizationId: orgB.id, contractId: contractA.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("excludes a soft-deleted file from the list", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "will-be-deleted.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("will-be-deleted"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    await deleteContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      fileId: uploaded.id,
    });

    const files = await listContractFiles({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
    });
    expect(files.find((f) => f.id === uploaded.id)).toBeUndefined();
  });
});

describe("deleteContractFile", () => {
  it("blocks MEMBER from deleting a file", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "member-cannot-delete.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("member-cannot-delete"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    await expect(
      deleteContractFile({
        userId: memberA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        fileId: uploaded.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const stillThere = await prisma.contractFile.findUnique({ where: { id: uploaded.id } });
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("org B cannot delete org A's file", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "org-b-cannot-delete.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("org-b-cannot-delete"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    await expect(
      deleteContractFile({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: contractA.id,
        fileId: uploaded.id,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("allows OWNER to delete a file, soft-deletes the DB row, and removes the physical file", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "owner-can-delete.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("owner-can-delete"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    const storageDriver = getStorageDriver();
    expect(await storageDriver.exists(row.storageKey)).toBe(true);

    await deleteContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      fileId: uploaded.id,
    });

    const deletedRow = await prisma.contractFile.findUnique({ where: { id: uploaded.id } });
    expect(deletedRow?.deletedAt).not.toBeNull();
    expect(await storageDriver.exists(row.storageKey)).toBe(false);
  });

  it("treats an already-deleted file as NotFound, not a silent no-op success", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "double-delete.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("double-delete"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    await deleteContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      fileId: uploaded.id,
    });

    await expect(
      deleteContractFile({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA.id,
        fileId: uploaded.id,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records a FILE_DELETED audit log entry", async () => {
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      originalName: "audit-delete.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytesWithMarker("audit-delete"),
    });
    const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(row.storageKey);

    await deleteContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA.id,
      fileId: uploaded.id,
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: uploaded.id, action: "FILE_DELETED" },
    });
    expect(log).not.toBeNull();
  });
});
