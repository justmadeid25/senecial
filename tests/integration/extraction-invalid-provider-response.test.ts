import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mocked BEFORE any other import so process-extraction-job.ts (imported
// transitively below) picks up the fake field-extraction service instead of
// the real DeterministicDevelopmentContractExtractor. This is the only way
// to deterministically exercise the INVALID_PROVIDER_RESPONSE path, since
// the real development extractor always produces schema-valid output.
vi.mock("@/server/services/extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/extraction")>();
  return {
    ...actual,
    getContractFieldExtractionService: () => ({
      extract: async () => ({
        // confidence=5 is outside contractFieldExtractionResultSchema's
        // [0,1] range - a real provider misbehaving in exactly this way.
        fields: [{ fieldKey: "title", normalizedValue: { value: "x" }, confidence: 5 }],
        warnings: [],
      }),
    }),
  };
});

const { MembershipRole, ExtractionJobStatus } = await import("@/generated/prisma/enums");
const { createContract } = await import("@/features/contracts/server/create-contract");
const { uploadContractFile } = await import("@/features/contract-files/server/upload-contract-file");
const { createExtractionJob } = await import("@/features/extraction/server/create-extraction-job");
const { processNextExtractionJob } = await import(
  "@/features/extraction/server/process-extraction-job"
);
const { prisma } = await import("@/server/db/client");
const { getStorageDriver } = await import("@/server/storage");

const TEST_EMAIL_DOMAIN = "extraction-invalid-provider-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let org: { id: string };
let owner: { id: string };
const createdContractIds: string[] = [];
const createdFileStorageKeys: string[] = [];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Invalid Provider Test Org", slug: `invalid-provider-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
});

describe("processNextExtractionJob - invalid provider response", () => {
  it("fails the job with INVALID_PROVIDER_RESPONSE when the field-extraction provider returns out-of-schema data", async () => {
    const contract = await createContract({
      userId: owner.id,
      organizationId: org.id,
      input: {
        title: "잘못된 제공자 응답 테스트",
        contractType: "SERVICE",
        status: "ACTIVE",
        autoRenewal: false,
        currency: "KRW",
      },
    });
    createdContractIds.push(contract.id);

    const buffer = Buffer.from(
      await Packer.toBuffer(
        new Document({ sections: [{ children: [new Paragraph("계약명: 잘못된 제공자 응답 테스트")] }] })
      )
    );
    const uploaded = await uploadContractFile({
      userId: owner.id,
      organizationId: org.id,
      contractId: contract.id,
      originalName: "invalid-provider.docx",
      mimeType: DOCX_MIME,
      buffer,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const created = await createExtractionJob({
      userId: owner.id,
      organizationId: org.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });

    await processNextExtractionJob("invalid-provider-worker");

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("INVALID_PROVIDER_RESPONSE");

    const suggestions = await prisma.contractFieldSuggestion.findMany({
      where: { extractionJobId: created.jobId },
    });
    expect(suggestions).toHaveLength(0);
  });
});
