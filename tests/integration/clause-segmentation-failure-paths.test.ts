import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mocked BEFORE any other import, same pattern as Phase 6's
// extraction-invalid-provider-response.test.ts - the real
// DeterministicKoreanClauseSegmenter always produces schema-valid output,
// so this is the only way to deterministically exercise
// SEGMENTATION_FAILED / retry / max-attempts and INVALID_SEGMENTATION_RESULT.
let shouldThrow = false;
vi.mock("@/server/services/clauses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/clauses")>();
  return {
    ...actual,
    getClauseSegmenter: () => ({
      segment: async () => {
        if (shouldThrow) {
          throw new Error("simulated segmenter crash");
        }
        // Missing required fields (e.g. `method`/`version`) - fails clauseSegmentationResultSchema.
        return { sections: [], clauses: [] } as unknown;
      },
    }),
  };
});

const { MembershipRole, ClauseSegmentationJobStatus } = await import("@/generated/prisma/enums");
const { createContract } = await import("@/features/contracts/server/create-contract");
const { uploadContractFile } = await import("@/features/contract-files/server/upload-contract-file");
const { createExtractionJob } = await import("@/features/extraction/server/create-extraction-job");
const { processNextExtractionJob } = await import(
  "@/features/extraction/server/process-extraction-job"
);
const { createClauseSegmentationJob } = await import(
  "@/features/clauses/server/create-clause-segmentation-job"
);
const { processNextClauseSegmentationJob } = await import(
  "@/features/clauses/server/process-clause-segmentation-job"
);
const { prisma } = await import("@/server/db/client");
const { getStorageDriver } = await import("@/server/storage");

const TEST_EMAIL_DOMAIN = "clause-segmentation-failure-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let org: { id: string };
let owner: { id: string };
const createdContractIds: string[] = [];
const createdFileStorageKeys: string[] = [];

async function processSpecificExtractionJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== "PENDING") return;
    await processNextExtractionJob(`${workerPrefix}-${attempt}`);
  }
}

async function processSpecificSegmentationJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== ClauseSegmentationJobStatus.PENDING) return;
    await processNextClauseSegmentationJob(`${workerPrefix}-${attempt}`);
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Clause Failure Test Org", slug: `clause-seg-failure-test-${Date.now()}` },
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
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
});

async function setUpDocument(title: string, name: string) {
  const contract = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  createdContractIds.push(contract.id);

  const buffer = Buffer.from(
    await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(`계약명: ${title}`)] }] }))
  );
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId: contract.id,
    originalName: name,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: org.id,
    contractId: contract.id,
    input: { contractFileId: uploaded.id },
  });
  await processSpecificExtractionJob(extractionJob.jobId, `setup-${name}`);
  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  return { contract, documentId: document.id };
}

describe("processNextClauseSegmentationJob - invalid segmentation result", () => {
  it("fails the job with INVALID_SEGMENTATION_RESULT when the segmenter returns out-of-schema data", async () => {
    shouldThrow = false;
    const { contract, documentId } = await setUpDocument("잘못된 분해 결과 테스트", "invalid-result.docx");

    const created = await createClauseSegmentationJob({
      userId: owner.id,
      organizationId: org.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    await processSpecificSegmentationJob(created.jobId, "invalid-result-worker");

    const job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ClauseSegmentationJobStatus.FAILED);
    expect(job.errorCode).toBe("INVALID_SEGMENTATION_RESULT");
  });
});

describe("processNextClauseSegmentationJob - retry and max attempts", () => {
  it("marks a crash FAILED (retryable), allows retry, then refuses once maxAttempts is reached", async () => {
    shouldThrow = true;
    const { contract, documentId } = await setUpDocument("재시도 테스트", "retry.docx");

    const created = await createClauseSegmentationJob({
      userId: owner.id,
      organizationId: org.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    await prisma.clauseSegmentationJob.update({ where: { id: created.jobId }, data: { maxAttempts: 2 } });

    await processSpecificSegmentationJob(created.jobId, "retry-worker-1");
    let job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ClauseSegmentationJobStatus.FAILED);
    expect(job.errorCode).toBe("SEGMENTATION_FAILED");
    expect(job.attempt).toBe(1);

    const retried = await createClauseSegmentationJob({
      userId: owner.id,
      organizationId: org.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    expect(retried.jobId).toBe(created.jobId);

    await processSpecificSegmentationJob(created.jobId, "retry-worker-2");
    job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ClauseSegmentationJobStatus.FAILED);
    expect(job.attempt).toBe(2);

    await expect(
      createClauseSegmentationJob({
        userId: owner.id,
        organizationId: org.id,
        contractId: contract.id,
        input: { extractedDocumentId: documentId },
      })
    ).rejects.toThrow();

    shouldThrow = false;
  });
});
