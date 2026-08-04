import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus, MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { getClauseSegmentationJob } from "@/features/clauses/server/get-clause-segmentation-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  claimNextPendingClauseSegmentationJob,
  createClauseSegmentationJob as createClauseSegmentationJobRow,
} from "@/server/repositories/clause-segmentation-job-repository";
import { findClausesBySegmentationJobId } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";
import { computeChecksum, getStorageDriver } from "@/server/storage";

const TEST_EMAIL_DOMAIN = "clause-segmentation-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildContractDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

const SAMPLE_LINES = [
  "사무실 임대차계약서",
  "",
  "제1조(목적)",
  "본 계약은 임대인과 임차인 간의 사무실 임대차에 관한 사항을 정함을 목적으로 한다.",
  "",
  "제2조(계약기간)",
  "본 계약의 계약기간은 2026년 8월 1일부터 2027년 7월 31일까지로 한다.",
  "",
  "제3조(비밀유지)",
  "양 당사자는 상대방의 비밀 정보를 제3자에게 누설하여서는 안 된다.",
];

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];
const createdFileStorageKeys: string[] = [];

const baseContractInput = {
  contractType: "LEASE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
  currency: "KRW",
};

async function createTestContract(userId: string, organizationId: string, title: string) {
  const created = await createContract({ userId, organizationId, input: { ...baseContractInput, title } });
  createdContractIds.push(created.id);
  return created;
}

/** Uploads a fixture, runs the Phase 6 extraction pipeline, and returns the resulting extractedDocumentId. */
async function createExtractedDocumentForContract(
  contractId: string,
  userId: string,
  organizationId: string,
  lines: string[],
  name: string
): Promise<string> {
  const buffer = await buildContractDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId,
    organizationId,
    contractId,
    originalName: name,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId,
    organizationId,
    contractId,
    input: { contractFileId: uploaded.id },
  });
  await processSpecificExtractionJob(extractionJob.jobId, `seg-test-extract-${name}`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  return document.id;
}

// Same "drain until my job resolves" pattern as Phase 6's extraction
// integration tests - claimNextPendingJob()/claimNextPendingClauseSegmentationJob()
// claim the globally oldest PENDING row, not a specific one.
async function processSpecificExtractionJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== "PENDING") {
      return;
    }
    await processNextExtractionJob(`${workerPrefix}-${attempt}`);
  }
  throw new Error(`extraction job ${jobId} never left PENDING`);
}

async function processSpecificSegmentationJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== ClauseSegmentationJobStatus.PENDING) {
      return before;
    }
    await processNextClauseSegmentationJob(`${workerPrefix}-${attempt}`);
  }
  throw new Error(`segmentation job ${jobId} never left PENDING`);
}

async function claimSpecificSegmentationJob(jobId: string, workerPrefix: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const before = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (before.status !== ClauseSegmentationJobStatus.PENDING) {
      return before;
    }
    await claimNextPendingClauseSegmentationJob(`${workerPrefix}-${attempt}`);
  }
  throw new Error(`segmentation job ${jobId} was never claimed`);
}

async function drainAllPendingSegmentationJobs() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await processNextClauseSegmentationJob(`drain-${attempt}`);
    if (!result.processed) {
      return;
    }
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Clause Segmentation Test Org A", slug: `clause-seg-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Clause Segmentation Test Org B", slug: `clause-seg-test-b-${Date.now()}` },
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
});

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractClause.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractSection.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractFieldSuggestion.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("createClauseSegmentationJob", () => {
  it("allows OWNER to create a job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "OWNER 조항분해 생성 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "owner-create.docx"
    );

    const result = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    expect(result.jobId).toBeTruthy();
  });

  it("allows MEMBER to create a job", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "MEMBER 조항분해 생성 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "member-create.docx"
    );

    const result = await createClauseSegmentationJob({
      userId: memberA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    expect(result.jobId).toBeTruthy();
  });

  it("blocks creating a second active job for the same document (dedup)", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "중복 조항분해 생성 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "dedup.docx"
    );

    await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });

    await expect(
      createClauseSegmentationJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { extractedDocumentId: documentId },
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks a cross-organization contractId with NotFoundError", async () => {
    const contractB = await createTestContract(ownerB.id, orgB.id, "다른 조직 계약");
    const documentId = await createExtractedDocumentForContract(
      contractB.id,
      ownerB.id,
      orgB.id,
      SAMPLE_LINES,
      "cross-org.docx"
    );

    await expect(
      createClauseSegmentationJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractB.id,
        input: { extractedDocumentId: documentId },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("claimNextPendingClauseSegmentationJob - concurrent claim safety", () => {
  it("never lets two concurrent claims pick up the same job", async () => {
    await drainAllPendingSegmentationJobs();

    const contract = await createTestContract(ownerA.id, orgA.id, "동시성 테스트");
    const jobIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const documentId = await createExtractedDocumentForContract(
        contract.id,
        ownerA.id,
        orgA.id,
        [...SAMPLE_LINES, `고유 표지 ${i}`],
        `concurrency-${i}.docx`
      );
      const result = await createClauseSegmentationJob({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        input: { extractedDocumentId: documentId },
      });
      jobIds.push(result.jobId);
    }

    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) => claimNextPendingClauseSegmentationJob(`worker-${i}`))
    );

    const claimedIds = claims.filter((c) => c !== null).map((c) => c!.id);
    const uniqueClaimedIds = new Set(claimedIds);
    expect(claimedIds.length).toBe(uniqueClaimedIds.size);
    expect(claimedIds.length).toBe(jobIds.length);

    for (const jobId of jobIds) {
      const job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe(ClauseSegmentationJobStatus.PROCESSING);
      expect(job.lockedBy).not.toBeNull();
    }
  });
});

describe("processNextClauseSegmentationJob - full pipeline success", () => {
  it("segments the document, classifies clauses, and reaches REVIEW_REQUIRED", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "전체 파이프라인 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "pipeline.docx"
    );

    const created = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });

    await processSpecificSegmentationJob(created.jobId, "pipeline-worker");

    const job = await getClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      jobId: created.jobId,
    });
    expect(job.status).toBe(ClauseSegmentationJobStatus.REVIEW_REQUIRED);
    expect(job.clauseCount).toBeGreaterThan(0);

    const clauses = await findClausesBySegmentationJobId({
      organizationId: orgA.id,
      segmentationJobId: created.jobId,
    });
    const article1 = clauses.find((c) => c.clauseNumber === "제1조");
    expect(article1?.suggestedClauseType).toBeDefined();
    // Every clause's text must be an exact substring of the extracted document.
    const document = await prisma.contractExtractedDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    for (const clause of clauses) {
      expect(document.text.slice(clause.startOffset, clause.endOffset)).toBe(clause.text);
      // The header itself must never be duplicated inside the body text (regression).
      if (clause.clauseNumber) {
        expect(clause.text).not.toContain(clause.clauseNumber);
      }
    }

    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.jobId, action: "CLAUSE_SEGMENTATION_REVIEW_REQUIRED" },
    });
    expect(log).not.toBeNull();
  });

  it("preserves an earlier segmentation job's clause rows when a newer job for the same document is processed", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "리비전 보존 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "revision.docx"
    );

    const firstJob = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    await processSpecificSegmentationJob(firstJob.jobId, "revision-worker-1");
    const firstClauses = await findClausesBySegmentationJobId({
      organizationId: orgA.id,
      segmentationJobId: firstJob.jobId,
    });
    expect(firstClauses.length).toBeGreaterThan(0);

    // Simulate a segmenter version bump producing a second, independent job
    // for the SAME document (dedup key includes segmenterVersion).
    const document = await prisma.contractExtractedDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    const secondJobRow = await createClauseSegmentationJobRow({
      organizationId: orgA.id,
      contractId: contract.id,
      extractedDocumentId: documentId,
      segmenterVersion: "dev-ko-v2-test-only",
      inputChecksum: document.contentChecksum,
      jobKey: computeChecksum(Buffer.from(`${documentId}:${document.contentChecksum}:dev-ko-v2-test-only`)),
      createdById: ownerA.id,
    });
    await processSpecificSegmentationJob(secondJobRow.id, "revision-worker-2");

    const firstClausesAfter = await findClausesBySegmentationJobId({
      organizationId: orgA.id,
      segmentationJobId: firstJob.jobId,
    });
    expect(firstClausesAfter.map((c) => c.id).sort()).toEqual(firstClauses.map((c) => c.id).sort());

    const secondClauses = await findClausesBySegmentationJobId({
      organizationId: orgA.id,
      segmentationJobId: secondJobRow.id,
    });
    expect(secondClauses.length).toBeGreaterThan(0);
    expect(secondClauses.map((c) => c.id)).not.toEqual(firstClauses.map((c) => c.id));
  });
});

describe("processNextClauseSegmentationJob - checksum mismatch", () => {
  it("fails the job with DOCUMENT_CHECKSUM_MISMATCH when the stored checksum no longer matches", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "체크섬 불일치 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "checksum-mismatch.docx"
    );

    const created = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });

    await prisma.clauseSegmentationJob.update({
      where: { id: created.jobId },
      data: { inputChecksum: "0".repeat(64) },
    });

    await processSpecificSegmentationJob(created.jobId, "checksum-mismatch-worker");

    const job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ClauseSegmentationJobStatus.FAILED);
    expect(job.errorCode).toBe("DOCUMENT_CHECKSUM_MISMATCH");
  });
});

describe("stale job recovery", () => {
  it("resets a stale PROCESSING job with retry budget left back to PENDING", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "정체 작업 복구 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      SAMPLE_LINES,
      "stale.docx"
    );
    const created = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });

    await claimSpecificSegmentationJob(created.jobId, "stale-worker");
    await prisma.clauseSegmentationJob.update({
      where: { id: created.jobId },
      data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const { recoverStaleClauseSegmentationJobs } = await import(
      "@/features/clauses/server/recover-stale-clause-segmentation-jobs"
    );
    const result = await recoverStaleClauseSegmentationJobs(15);
    expect(result.recoveredToPending).toBeGreaterThanOrEqual(1);

    const job = await prisma.clauseSegmentationJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.status).toBe(ClauseSegmentationJobStatus.PENDING);
    expect(job.lockedAt).toBeNull();
  });
});

describe("AuditLog exclusions", () => {
  it("never includes the raw extracted document text or clause text in any AuditLog metadata", async () => {
    const secretMarker = "극비 조항 원문 마커 텍스트";
    const contract = await createTestContract(ownerA.id, orgA.id, "감사로그 원문제외 테스트");
    const documentId = await createExtractedDocumentForContract(
      contract.id,
      ownerA.id,
      orgA.id,
      [...SAMPLE_LINES, secretMarker],
      "audit-no-text.docx"
    );
    const created = await createClauseSegmentationJob({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { extractedDocumentId: documentId },
    });
    await processSpecificSegmentationJob(created.jobId, "audit-no-text-worker");

    const logs = await prisma.auditLog.findMany({ where: { entityId: created.jobId } });
    for (const log of logs) {
      expect(JSON.stringify(log.metadata)).not.toContain(secretMarker);
    }
  });
});
