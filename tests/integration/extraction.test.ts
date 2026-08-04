import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExtractionJobStatus, MembershipRole, SuggestionReviewStatus } from "@/generated/prisma/enums";
import { EXTRACTOR_VERSION } from "@/domain/extraction/extractor-version";
import { createContract } from "@/features/contracts/server/create-contract";
import { updateContract } from "@/features/contracts/server/update-contract";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { applyApprovedSuggestions } from "@/features/extraction/server/apply-approved-suggestions";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { getExtractionJob } from "@/features/extraction/server/get-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { recoverStaleExtractionJobs } from "@/features/extraction/server/recover-stale-extraction-jobs";
import { reviewSuggestion } from "@/features/extraction/server/review-suggestion";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  claimNextPendingJob,
  findExtractionJobById,
} from "@/server/repositories/extraction-job-repository";
import { findSuggestionsByJobId } from "@/server/repositories/field-suggestion-repository";
import { prisma } from "@/server/db/client";
import { getStorageDriver } from "@/server/storage";

const TEST_EMAIL_DOMAIN = "extraction-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildContractDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((line) => new Paragraph(line)) }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function buildFakeDocxBuffer(marker: string): Buffer {
  // Passes matchesDocxSignature (ZIP header + OOXML path markers) but is
  // not a real ZIP archive, so upload succeeds but mammoth's
  // extractRawText() fails at processing time - used to exercise the
  // TEXT_EXTRACTION_FAILED / retry path deterministically.
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const marker_ = Buffer.from(`[Content_Types].xml word/document.xml ${marker}`, "latin1");
  return Buffer.concat([header, marker_]);
}

const HWP_OLE2_BYTES = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00,
]);

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };
let counterpartyA: { id: string };

const createdContractIds: string[] = [];
const createdFileStorageKeys: string[] = [];

const baseContractInput = {
  contractType: "LEASE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
  currency: "KRW",
};

async function createTestContract(userId: string, organizationId: string, title: string) {
  const created = await createContract({
    userId,
    organizationId,
    input: { ...baseContractInput, title },
  });
  createdContractIds.push(created.id);
  return created;
}

async function uploadFixture(
  contractId: string,
  userId: string,
  organizationId: string,
  lines: string[],
  name: string
) {
  const buffer = await buildContractDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId,
    organizationId,
    contractId,
    originalName: name,
    mimeType: DOCX_MIME,
    buffer,
  });
  const row = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(row.storageKey);
  return { file: uploaded, checksum: row.checksum };
}

/**
 * claimNextPendingJob()/processNextExtractionJob() always claim the
 * globally oldest PENDING job across the whole table (correct worker-pool
 * semantics - see the repository's own comment), not a specific job. Many
 * tests in this file intentionally leave jobs PENDING (dedup/permission
 * tests never process them), so a test that needs ITS OWN job processed
 * cannot assume a single call claims it. These helpers drain the queue
 * (processing/claiming whatever comes up, harmlessly) until the job this
 * test actually cares about has left PENDING.
 */
async function processSpecificJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== ExtractionJobStatus.PENDING) {
      return before;
    }
    await processNextExtractionJob(`${workerPrefix}-${attempt}`);
  }
  throw new Error(`extraction job ${jobId} never left PENDING after repeated processing attempts`);
}

async function claimSpecificJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== ExtractionJobStatus.PENDING) {
      return before;
    }
    await claimNextPendingJob(`${workerPrefix}-${attempt}`);
  }
  throw new Error(`extraction job ${jobId} was never claimed after repeated attempts`);
}

/** Processes every currently-PENDING job (from earlier tests that deliberately left some unprocessed) so a later test starts with a clean queue. */
async function drainAllPendingJobs() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await processNextExtractionJob(`drain-${attempt}`);
    if (!result.processed) {
      return;
    }
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Extraction Test Org A", slug: `extraction-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Extraction Test Org B", slug: `extraction-test-b-${Date.now()}` },
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

  counterpartyA = await prisma.counterparty.create({
    data: { organizationId: orgA.id, name: "감마파트너스" },
  });
});

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractFieldSuggestion.deleteMany({
    where: { contractId: { in: createdContractIds } },
  });
  await prisma.contractExtractedDocument.deleteMany({
    where: { contractId: { in: createdContractIds } },
  });
  await prisma.contractExtractionJob.deleteMany({
    where: { contractId: { in: createdContractIds } },
  });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.counterparty.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("createExtractionJob", () => {
  it("allows OWNER to create a job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "OWNER 작업 생성 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: OWNER 작업 생성 테스트"],
      "owner-create.docx"
    );

    const result = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    expect(result.jobId).toBeTruthy();
  });

  it("allows MEMBER to create a job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "MEMBER 작업 생성 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: MEMBER 작업 생성 테스트"],
      "member-create.docx"
    );

    const result = await createExtractionJob({
      userId: memberA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    expect(result.jobId).toBeTruthy();
  });

  it("blocks creating a second active job for the same file (dedup)", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "중복 작업 생성 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 중복 작업 생성 테스트"],
      "dedup.docx"
    );

    await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await expect(
      createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { contractFileId: file.id },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks a cross-organization contractId with NotFoundError", async () => {
    const contractB = await createTestContract(ownerB.id, orgB.id, "다른 조직 계약");
    const { file } = await uploadFixture(
      contractB.id,
      ownerB.id,
      orgB.id,
      ["계약명: 다른 조직 계약"],
      "cross-org.docx"
    );

    await expect(
      createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractB.id,
        input: { contractFileId: file.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates the job without reading the file from storage (fast path)", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "빠른 작업 생성 테스트");
    const { file, checksum } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 빠른 작업 생성 테스트"],
      "fast-path.docx"
    );

    const storageDriver = getStorageDriver();
    let getBufferCalls = 0;
    const originalGetBuffer = storageDriver.getBuffer.bind(storageDriver);
    storageDriver.getBuffer = async (key: string) => {
      getBufferCalls += 1;
      return originalGetBuffer(key);
    };

    try {
      const result = await createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { contractFileId: file.id },
      });
      expect(getBufferCalls).toBe(0);

      const job = await findExtractionJobById({
        organizationId: orgA.id,
        contractId: contract.id,
        jobId: result.jobId,
      });
      expect(job?.inputChecksum).toBe(checksum);
      expect(job?.status).toBe(ExtractionJobStatus.PENDING);
    } finally {
      storageDriver.getBuffer = originalGetBuffer;
    }
  });
});

describe("claimNextPendingJob - concurrent claim safety", () => {
  it("never lets two concurrent claims pick up the same job", async () => {
    // Earlier tests in this file (createExtractionJob) deliberately leave
    // jobs PENDING - drain them first so this test's 5 concurrent claims
    // are guaranteed to land on exactly the 5 jobs it creates below.
    await drainAllPendingJobs();

    const contract = await createTestContract(ownerA.id, orgA.id, "동시성 테스트");
    const jobIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { file } = await uploadFixture(
        contract.id,
        ownerA.id,
        orgA.id,
        [`계약명: 동시성 테스트 ${i}`],
        `concurrency-${i}.docx`
      );
      const result = await createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { contractFileId: file.id },
      });
      jobIds.push(result.jobId);
    }

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) => claimNextPendingJob(`worker-${i}`))
    );

    const claimedIds = claims.filter((c) => c !== null).map((c) => c!.id);
    const uniqueClaimedIds = new Set(claimedIds);
    expect(claimedIds.length).toBe(uniqueClaimedIds.size);
    expect(claimedIds.length).toBe(jobIds.length);

    for (const jobId of jobIds) {
      const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe(ExtractionJobStatus.PROCESSING);
      expect(job.lockedBy).not.toBeNull();
    }
  });
});

describe("processNextExtractionJob - full pipeline success", () => {
  it("extracts text, produces suggestions, and reaches REVIEW_REQUIRED", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "전체 파이프라인 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      [
        "계약명: 전체 파이프라인 테스트 (수정본)",
        "계약번호: PIPELINE-001",
        "계약기간: 2026-09-01 ~ 2027-08-31",
        "계약금액: 금 삼천만원정",
        "상대방: 감마파트너스",
        "본 계약은 자동갱신 됩니다.",
      ],
      "pipeline.docx"
    );

    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await processSpecificJob(created.jobId, "integration-test-worker");

    const job = await getExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId: created.jobId,
    });
    expect(job.status).toBe(ExtractionJobStatus.REVIEW_REQUIRED);
    expect(job.extractionMethod).toBe("mammoth");
    expect(job.suggestions.length).toBeGreaterThan(0);

    const amountSuggestion = job.suggestions.find((s) => s.fieldKey === "amount");
    expect(amountSuggestion?.normalizedValue).toEqual({ value: "30000000" });

    const document = await prisma.contractExtractedDocument.findUnique({
      where: { extractionJobId: created.jobId },
    });
    expect(document).not.toBeNull();
    expect(document?.text).toContain("PIPELINE-001");

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.jobId, action: "EXTRACTION_REVIEW_REQUIRED" },
    });
    expect(log).not.toBeNull();
  });
});

describe("processNextExtractionJob - checksum mismatch", () => {
  it("fails the job with CHECKSUM_MISMATCH when the job's expected checksum no longer matches the stored file", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "체크섬 불일치 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 체크섬 불일치 테스트"],
      "checksum-mismatch.docx"
    );

    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await prisma.contractExtractionJob.update({
      where: { id: created.jobId },
      data: { inputChecksum: "0".repeat(64) },
    });

    await processSpecificJob(created.jobId, "checksum-mismatch-worker");

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("CHECKSUM_MISMATCH");
  });
});

describe("processNextExtractionJob - retry and max attempts", () => {
  it("marks a retryable failure FAILED, allows retry via createExtractionJob, and refuses once maxAttempts is reached", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "재시도 테스트");
    const buffer = buildFakeDocxBuffer("retry-test");
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      originalName: "retry.docx",
      mimeType: DOCX_MIME,
      buffer,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });

    // Keep the test fast: cap this job at 2 attempts instead of the config default.
    await prisma.contractExtractionJob.update({
      where: { id: created.jobId },
      data: { maxAttempts: 2 },
    });

    await processSpecificJob(created.jobId, "retry-worker-1");
    let job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("TEXT_EXTRACTION_FAILED");
    expect(job.attempt).toBe(1);

    const retried = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });
    expect(retried.jobId).toBe(created.jobId);

    await processSpecificJob(created.jobId, "retry-worker-2");
    job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.attempt).toBe(2);

    await expect(
      createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { contractFileId: uploaded.id },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("recoverStaleExtractionJobs", () => {
  it("resets a stale PROCESSING job with retry budget left back to PENDING", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "정체 작업 복구 테스트 1");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 정체 작업 복구 테스트 1"],
      "stale-recoverable.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await claimSpecificJob(created.jobId, "stale-recoverable-worker");
    await prisma.contractExtractionJob.update({
      where: { id: created.jobId },
      data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const result = await recoverStaleExtractionJobs(15);
    expect(result.recoveredToPending).toBeGreaterThanOrEqual(1);

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.status).toBe(ExtractionJobStatus.PENDING);
    expect(job.lockedAt).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.jobId, action: "EXTRACTION_RETRY_REQUESTED" },
    });
    expect(log).not.toBeNull();
  });

  it("marks a stale PROCESSING job with no retry budget left as FAILED", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "정체 작업 복구 테스트 2");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 정체 작업 복구 테스트 2"],
      "stale-exhausted.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await claimSpecificJob(created.jobId, "stale-exhausted-worker");
    await prisma.contractExtractionJob.update({
      where: { id: created.jobId },
      data: {
        lockedAt: new Date(Date.now() - 60 * 60 * 1000),
        attempt: 3,
        maxAttempts: 3,
      },
    });

    await recoverStaleExtractionJobs(15);

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("MAX_ATTEMPTS_REACHED");
  });
});

describe("reviewSuggestion", () => {
  async function setUpReviewableJob(title: string) {
    const contract = await createTestContract(ownerA.id, orgA.id, title);
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      [
        `계약명: ${title}`,
        "계약번호: REVIEW-001",
        "상대방: 감마파트너스",
        "본 계약은 자동갱신 됩니다.",
      ],
      "review-setup.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    await processSpecificJob(created.jobId, "review-setup-worker");
    const suggestions = await findSuggestionsByJobId({
      organizationId: orgA.id,
      extractionJobId: created.jobId,
    });
    return { contract, jobId: created.jobId, suggestions };
  }

  it("accepts a non-counterparty suggestion", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("검토-승인 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");
    expect(target).toBeDefined();

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "ACCEPT" },
    });

    const updated = await prisma.contractFieldSuggestion.findUniqueOrThrow({
      where: { id: target!.id },
    });
    expect(updated.reviewStatus).toBe(SuggestionReviewStatus.ACCEPTED);
  });

  it("rejects a suggestion", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("검토-거절 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "REJECT" },
    });

    const updated = await prisma.contractFieldSuggestion.findUniqueOrThrow({
      where: { id: target!.id },
    });
    expect(updated.reviewStatus).toBe(SuggestionReviewStatus.REJECTED);
  });

  it("edits a suggestion, preserving the AI value separately from the reviewed value", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("검토-수정 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");
    const originalNormalizedValue = target!.normalizedValue;

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "EDIT", reviewedValue: { value: "REVIEW-001-EDITED" } },
    });

    const updated = await prisma.contractFieldSuggestion.findUniqueOrThrow({
      where: { id: target!.id },
    });
    expect(updated.reviewStatus).toBe(SuggestionReviewStatus.EDITED);
    expect(updated.reviewedValue).toEqual({ value: "REVIEW-001-EDITED" });
    expect(updated.normalizedValue).toEqual(originalNormalizedValue);
  });

  it("rejects EDIT with a malformed value shape", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("검토-형식오류 테스트");
    const target = suggestions.find((s) => s.fieldKey === "autoRenewal");

    await expect(
      reviewSuggestion({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
        suggestionId: target!.id,
        input: { action: "EDIT", reviewedValue: { value: "not-a-boolean" } },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects ACCEPT for a counterpartyName suggestion", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("상대방-승인거부 테스트");
    const target = suggestions.find((s) => s.fieldKey === "counterpartyName");
    expect(target).toBeDefined();

    await expect(
      reviewSuggestion({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
        suggestionId: target!.id,
        input: { action: "ACCEPT" },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows REJECT for a counterpartyName suggestion", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("상대방-거절 테스트");
    const target = suggestions.find((s) => s.fieldKey === "counterpartyName");

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "REJECT" },
    });

    const updated = await prisma.contractFieldSuggestion.findUniqueOrThrow({
      where: { id: target!.id },
    });
    expect(updated.reviewStatus).toBe(SuggestionReviewStatus.REJECTED);
  });

  it("allows EDIT for a counterpartyName suggestion with a valid org-scoped counterpartyId", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("상대방-선택 테스트");
    const target = suggestions.find((s) => s.fieldKey === "counterpartyName");

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "EDIT", reviewedValue: { counterpartyId: counterpartyA.id } },
    });

    const updated = await prisma.contractFieldSuggestion.findUniqueOrThrow({
      where: { id: target!.id },
    });
    expect(updated.reviewStatus).toBe(SuggestionReviewStatus.EDITED);
    expect(updated.reviewedValue).toEqual({ counterpartyId: counterpartyA.id });
  });

  it("rejects EDIT for counterpartyName pointing at a counterparty from another organization", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("상대방-타조직 테스트");
    const target = suggestions.find((s) => s.fieldKey === "counterpartyName");
    const otherOrgCounterparty = await prisma.counterparty.create({
      data: { organizationId: orgB.id, name: "타조직 상대방" },
    });

    await expect(
      reviewSuggestion({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
        suggestionId: target!.id,
        input: { action: "EDIT", reviewedValue: { counterpartyId: otherOrgCounterparty.id } },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.counterparty.delete({ where: { id: otherOrgCounterparty.id } });
  });

  it("refuses review when the job is not REVIEW_REQUIRED", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "상태오류 검토 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 상태오류 검토 테스트"],
      "wrong-status.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await expect(
      reviewSuggestion({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId: created.jobId,
        suggestionId: "nonexistent-suggestion-id",
        input: { action: "ACCEPT" },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks org B from reviewing org A's suggestion (cross-org access)", async () => {
    const { contract, jobId, suggestions } = await setUpReviewableJob("교차조직 검토 차단 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");

    await expect(
      reviewSuggestion({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: contract.id,
        jobId,
        suggestionId: target!.id,
        input: { action: "ACCEPT" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("applyApprovedSuggestions", () => {
  async function setUpReviewedJob(title: string) {
    const contract = await createTestContract(ownerA.id, orgA.id, title);
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      [
        `계약명: ${title}`,
        "계약번호: APPLY-001",
        "상대방: 감마파트너스",
        "본 계약은 자동갱신 됩니다.",
      ],
      "apply-setup.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    await processSpecificJob(created.jobId, "apply-setup-worker");
    const suggestions = await findSuggestionsByJobId({
      organizationId: orgA.id,
      extractionJobId: created.jobId,
    });
    return { contract, jobId: created.jobId, suggestions };
  }

  it("applies only ACCEPTED/EDITED suggestions, excluding PENDING and REJECTED", async () => {
    const { contract, jobId, suggestions } = await setUpReviewedJob("적용-선택 테스트");
    const contractNumberSuggestion = suggestions.find((s) => s.fieldKey === "contractNumber");
    const autoRenewalSuggestion = suggestions.find((s) => s.fieldKey === "autoRenewal");

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: contractNumberSuggestion!.id,
      input: { action: "ACCEPT" },
    });
    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: autoRenewalSuggestion!.id,
      input: { action: "REJECT" },
    });
    // Every other suggestion for this job stays PENDING.

    const result = await applyApprovedSuggestions({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
    });
    expect(result.appliedFieldCount).toBe(1);

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.contractNumber).toBe("APPLY-001");
    // autoRenewal was REJECTED, so it must stay at the contract's original value.
    expect(updatedContract.autoRenewal).toBe(false);

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(ExtractionJobStatus.COMPLETED);
  });

  it("blocks apply with the exact required message when the contract changed since extraction", async () => {
    const { contract, jobId, suggestions } = await setUpReviewedJob("적용-충돌 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");
    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "ACCEPT" },
    });

    // Simulate the reviewer (or someone else) editing the contract manually
    // after the extraction job reached REVIEW_REQUIRED.
    await updateContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { ...baseContractInput, title: "적용-충돌 테스트 (변경됨)" },
    });

    await expect(
      applyApprovedSuggestions({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
      })
    ).rejects.toThrow("계약 정보가 추출 이후 변경되었습니다. 현재 값과 제안값을 다시 확인해 주세요.");
  });

  it("throws and leaves the contract unchanged when zero suggestions are approved", async () => {
    const { contract, jobId } = await setUpReviewedJob("적용-없음 테스트");
    const before = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });

    await expect(
      applyApprovedSuggestions({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.contractNumber).toBe(before.contractNumber);

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(ExtractionJobStatus.REVIEW_REQUIRED);
  });

  it("makes no partial write when an approved counterpartyName suggestion's target was deleted before apply", async () => {
    const { contract, jobId, suggestions } = await setUpReviewedJob("적용-롤백 테스트");
    const counterpartySuggestion = suggestions.find((s) => s.fieldKey === "counterpartyName");
    const contractNumberSuggestion = suggestions.find((s) => s.fieldKey === "contractNumber");

    const doomedCounterparty = await prisma.counterparty.create({
      data: { organizationId: orgA.id, name: "삭제될 상대방" },
    });

    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: counterpartySuggestion!.id,
      input: { action: "EDIT", reviewedValue: { counterpartyId: doomedCounterparty.id } },
    });
    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: contractNumberSuggestion!.id,
      input: { action: "ACCEPT" },
    });

    // Hard-delete the counterparty between review and apply (soft-delete
    // isn't modeled for Counterparty in this schema, so a real delete
    // reproduces "no longer belongs to the organization").
    await prisma.counterparty.delete({ where: { id: doomedCounterparty.id } });

    const before = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });

    await expect(
      applyApprovedSuggestions({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        jobId,
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.contractNumber).toBe(before.contractNumber);
    expect(after.counterpartyId).toBe(before.counterpartyId);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(ExtractionJobStatus.REVIEW_REQUIRED);
  });

  it("never auto-creates a Counterparty row even when a counterpartyName suggestion exists", async () => {
    const countBefore = await prisma.counterparty.count({ where: { organizationId: orgA.id } });
    await setUpReviewedJob("상대방-자동생성금지 테스트");
    const countAfter = await prisma.counterparty.count({ where: { organizationId: orgA.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("blocks org B from applying org A's job (cross-org access)", async () => {
    const { contract, jobId, suggestions } = await setUpReviewedJob("적용-교차조직 테스트");
    const target = suggestions.find((s) => s.fieldKey === "contractNumber");
    await reviewSuggestion({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId,
      suggestionId: target!.id,
      input: { action: "ACCEPT" },
    });

    await expect(
      applyApprovedSuggestions({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: contract.id,
        jobId,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getExtractionJob - cross-org access and AuditLog raw-text exclusion", () => {
  it("blocks org B from reading org A's extraction job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "조회-교차조직 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 조회-교차조직 테스트"],
      "get-cross-org.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    await expect(
      getExtractionJob({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: contract.id,
        jobId: created.jobId,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never includes the raw extracted document text in any AuditLog metadata", async () => {
    const secretMarker = "극비 계약 조항 원문 텍스트 마커";
    const contract = await createTestContract(ownerA.id, orgA.id, "감사로그 원문제외 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      [`계약명: 감사로그 원문제외 테스트`, secretMarker],
      "audit-no-text.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    await processSpecificJob(created.jobId, "audit-no-text-worker");

    const logs = await prisma.auditLog.findMany({ where: { entityId: created.jobId } });
    for (const log of logs) {
      expect(JSON.stringify(log.metadata)).not.toContain(secretMarker);
    }
  });

  it("never exposes storageKey through getExtractionJob's result shape", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "storageKey 비노출 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: storageKey 비노출 테스트"],
      "no-storage-key.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });

    const job = await getExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId: created.jobId,
    });
    expect(job).not.toHaveProperty("storageKey");
  });
});

describe("HWP policy behavior (Option C)", () => {
  it("allows creating a job for an .hwp upload but fails processing with UNSUPPORTED_FORMAT", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "HWP 정책 테스트");
    const uploaded = await uploadContractFile({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      originalName: "계약서.hwp",
      mimeType: "application/x-hwp",
      buffer: HWP_OLE2_BYTES,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });

    await processSpecificJob(created.jobId, "hwp-worker");

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("UNSUPPORTED_FORMAT");

    // UNSUPPORTED_FORMAT is non-retryable - a further request must be
    // refused rather than silently retried forever.
    await expect(
      createExtractionJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { contractFileId: uploaded.id },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("EXTRACTOR_VERSION consistency", () => {
  it("stores the current EXTRACTOR_VERSION on every created job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "버전 일관성 테스트");
    const { file } = await uploadFixture(
      contract.id,
      ownerA.id,
      orgA.id,
      ["계약명: 버전 일관성 테스트"],
      "version.docx"
    );
    const created = await createExtractionJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { contractFileId: file.id },
    });
    const job = await prisma.contractExtractionJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.extractorVersion).toBe(EXTRACTOR_VERSION);
  });
});
