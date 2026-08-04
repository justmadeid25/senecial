import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { computeClauseTextChecksum } from "@/domain/ai/clause-text-checksum";
import {
  enqueueEmbeddingJobsForClauses,
  scanAndEnqueueStaleClauseEmbeddings,
} from "@/features/ai/server/enqueue-embedding-jobs";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { recoverStaleEmbeddingJobs } from "@/features/ai/server/recover-stale-embedding-jobs";
import { claimNextPendingEmbeddingJob } from "@/server/repositories/embedding-job-repository";
import { findLatestEmbeddingForClause } from "@/server/repositories/clause-embedding-repository";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "embedding-pipeline-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLE_LINES = [
  "사무실 임대차계약서",
  "",
  "제1조(목적)",
  "본 계약은 임대인과 임차인 간의 사무실 임대차에 관한 사항을 정함을 목적으로 한다.",
  "",
  "제2조(계약기간)",
  "본 계약의 계약기간은 2026년 8월 1일부터 2027년 7월 31일까지로 한다.",
];

let org: { id: string };
let owner: { id: string };
let contractId: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drainAllPendingExtractionJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await processNextExtractionJob(`drain-extract-${attempt}`);
    if (!result.processed) return;
  }
}

async function drainAllPendingSegmentationJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await processNextClauseSegmentationJob(`drain-seg-${attempt}`);
    if (!result.processed) return;
  }
}

async function drainAllPendingEmbeddingJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await processNextEmbeddingJob(`drain-embed-${attempt}`);
    if (!result.processed) return;
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Embedding Pipeline Test Org", slug: `embedding-pipeline-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Embedding Test Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: {
      title: "임베딩 테스트 계약",
      contractType: "LEASE",
      status: "ACTIVE",
      autoRenewal: false,
      currency: "KRW",
    },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "embedding-test.docx",
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    input: { contractFileId: uploaded.id },
  });
  await drainAllPendingExtractionJobs();

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });

  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    input: { extractedDocumentId: document.id },
  });
  // The segmentation hook (process-clause-segmentation-job.ts) enqueues
  // embedding jobs automatically as a side effect of draining this queue -
  // this beforeAll intentionally does NOT drain the embedding queue itself,
  // so the first test below can observe those auto-enqueued PENDING jobs.
  await drainAllPendingSegmentationJobs();
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractClause.deleteMany({ where: { contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("Embedding pipeline (Phase 12 Part A)", () => {
  it("segmentation automatically enqueues an EmbeddingJob per clause (never blocking the segmentation job itself)", async () => {
    const clauses = await prisma.contractClause.findMany({ where: { contractId } });
    expect(clauses.length).toBeGreaterThan(0);

    const jobs = await prisma.embeddingJob.findMany({
      where: { contractClauseId: { in: clauses.map((c) => c.id) } },
    });
    expect(jobs.length).toBe(clauses.length);
    expect(jobs.every((j) => j.status === "PENDING")).toBe(true);
  });

  it("re-enqueuing for a clause with unchanged text is a no-op (idempotent)", async () => {
    const clauses = await prisma.contractClause.findMany({ where: { contractId } });
    const beforeCount = await prisma.embeddingJob.count({ where: { organizationId: org.id } });

    const { enqueued } = await enqueueEmbeddingJobsForClauses(
      clauses.map((c) => ({ id: c.id, organizationId: c.organizationId, normalizedText: c.normalizedText }))
    );
    expect(enqueued).toBe(0);

    const afterCount = await prisma.embeddingJob.count({ where: { organizationId: org.id } });
    expect(afterCount).toBe(beforeCount);
  });

  it("processing a job creates a ClauseEmbedding (version 1, isLatest) with the provider's real dimension", async () => {
    await drainAllPendingEmbeddingJobs();

    const clauses = await prisma.contractClause.findMany({ where: { contractId } });
    for (const clause of clauses) {
      const embedding = await findLatestEmbeddingForClause(clause.id);
      expect(embedding).not.toBeNull();
      expect(embedding?.embeddingVersion).toBe(1);
      expect(embedding?.isLatest).toBe(true);
      expect(embedding?.vector.length).toBe(embedding?.dimension);
      expect(embedding?.checksum).toBe(computeClauseTextChecksum(clause.normalizedText));
    }

    const remainingJobs = await prisma.embeddingJob.count({
      where: { contractClauseId: { in: clauses.map((c) => c.id) }, status: "PENDING" },
    });
    expect(remainingJobs).toBe(0);
  });

  it("two concurrent workers racing the same PENDING job - exactly one claims it", async () => {
    const clause = await prisma.contractClause.findFirstOrThrow({ where: { contractId } });
    // Force a fresh stale state to have something claimable.
    await prisma.contractClause.update({
      where: { id: clause.id },
      data: { normalizedText: `${clause.normalizedText} 동시성 테스트 추가 문장.` },
    });
    await scanAndEnqueueStaleClauseEmbeddings(org.id);

    const [a, b] = await Promise.all([
      claimNextPendingEmbeddingJob("race-worker-a"),
      claimNextPendingEmbeddingJob("race-worker-b"),
    ]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // never the same job claimed twice
    await drainAllPendingEmbeddingJobs();
  });

  it("editing a clause's text creates a NEW embedding version (never mutates the old row - §Embedding Pipeline)", async () => {
    const clause = await prisma.contractClause.findFirstOrThrow({ where: { contractId } });
    const originalEmbedding = await findLatestEmbeddingForClause(clause.id);
    expect(originalEmbedding).not.toBeNull();

    const newNormalizedText = `${clause.normalizedText} 완전히 새로운 추가 문장입니다.`;
    await prisma.contractClause.update({ where: { id: clause.id }, data: { normalizedText: newNormalizedText } });

    const { enqueued } = await scanAndEnqueueStaleClauseEmbeddings(org.id);
    expect(enqueued).toBeGreaterThanOrEqual(1);

    await drainAllPendingEmbeddingJobs();

    const newLatest = await findLatestEmbeddingForClause(clause.id);
    expect(newLatest?.embeddingVersion).toBe((originalEmbedding?.embeddingVersion ?? 0) + 1);
    expect(newLatest?.isLatest).toBe(true);
    expect(newLatest?.checksum).toBe(computeClauseTextChecksum(newNormalizedText));

    // The OLD row must still exist, untouched, just no longer latest -
    // "기존 조항은 수정하지 않는다" applies to embeddings too.
    const oldRow = await prisma.clauseEmbedding.findUnique({ where: { id: originalEmbedding!.id } });
    expect(oldRow).not.toBeNull();
    expect(oldRow?.isLatest).toBe(false);
    expect(oldRow?.checksum).toBe(originalEmbedding!.checksum); // unchanged
    expect(oldRow?.vector).toEqual(originalEmbedding!.vector); // unchanged

    const totalVersions = await prisma.clauseEmbedding.count({ where: { contractClauseId: clause.id } });
    expect(totalVersions).toBe(newLatest!.embeddingVersion); // every past version preserved
  });

  it("recoverStaleEmbeddingJobs resets a stuck PROCESSING job back to PENDING", async () => {
    const clause = await prisma.contractClause.findFirstOrThrow({ where: { contractId } });
    await prisma.contractClause.update({
      where: { id: clause.id },
      data: { normalizedText: `${clause.normalizedText} stale-recovery-test.` },
    });
    await scanAndEnqueueStaleClauseEmbeddings(org.id);

    const claimed = await claimNextPendingEmbeddingJob("stale-sim-worker");
    expect(claimed).not.toBeNull();
    // Simulate the worker dying mid-job - push lockedAt into the past.
    await prisma.embeddingJob.update({ where: { id: claimed!.id }, data: { lockedAt: new Date(0) } });

    const result = await recoverStaleEmbeddingJobs(15);
    expect(result.recoveredToPending).toBeGreaterThanOrEqual(1);

    const reset = await prisma.embeddingJob.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(reset.status).toBe("PENDING");
    expect(reset.lockedAt).toBeNull();

    await drainAllPendingEmbeddingJobs();
  });
});
