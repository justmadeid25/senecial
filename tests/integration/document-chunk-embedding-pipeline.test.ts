import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { createContract } from "@/features/contracts/server/create-contract";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { scanAndEnqueueStaleChunkEmbeddings } from "@/features/ai/server/enqueue-chunk-embedding-jobs";
import { findChunksByContract } from "@/server/repositories/contract-document-chunk-repository";
import { findLatestEmbeddingForChunk } from "@/server/repositories/contract-document-chunk-embedding-repository";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "chunk-embedding-pipeline-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLE_LINES = [
  "사무실 임대차계약서",
  "",
  "제1조(목적)",
  "본 계약은 임대인과 임차인 간의 사무실 임대차에 관한 사항을 정함을 목적으로 한다.",
  "",
  "제9조(비밀유지)",
  "갑과 을은 본 계약의 내용을 제3자에게 누설하지 아니한다.",
  "본 계약은 2028년 12월 31일 종료된다.",
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

async function drainAllPendingChunkEmbeddingJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await processNextChunkEmbeddingJob(`drain-chunk-embed-${attempt}`);
    if (!result.processed) return;
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Chunk Embedding Pipeline Test Org", slug: `chunk-embedding-pipeline-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Chunk Embedding Test Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "청크 임베딩 테스트 계약", contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "chunk-embedding-test.docx",
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  await createExtractionJob({ userId: owner.id, organizationId: org.id, contractId, input: { contractFileId: uploaded.id } });
  // Deliberately NEVER run clause segmentation in this test file - §11's
  // whole point is that raw chunk creation/embedding must work
  // independently of clause segmentation ever running at all.
  await drainAllPendingExtractionJobs();
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractDocumentChunk.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
  await prisma.contractFile.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.membership.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("Document chunk + embedding pipeline (Phase 14.1 §4/§5/§11)", () => {
  it("extraction alone (no clause segmentation) creates raw document chunks", async () => {
    const chunks = await findChunksByContract({ organizationId: org.id, contractId });
    expect(chunks.length).toBeGreaterThan(0);
    // The chunk containing the fact must exist even though no clause
    // segmentation ever ran for this contract.
    const terminationChunk = chunks.find((c) => c.text.includes("2028년 12월 31일"));
    expect(terminationChunk).toBeDefined();
    expect(terminationChunk!.headingContext).toContain("제9조");
  });

  it("chunk creation auto-enqueues embedding jobs (PENDING, one per chunk)", async () => {
    const chunks = await findChunksByContract({ organizationId: org.id, contractId });
    const jobs = await prisma.contractDocumentChunkEmbeddingJob.findMany({ where: { organizationId: org.id } });
    expect(jobs.length).toBe(chunks.length);
    expect(jobs.every((j) => j.status === "PENDING")).toBe(true);
  });

  it("processing the embedding queue produces a real ClauseEmbedding-equivalent row per chunk, with the production dimension and a populated native pgvector column", async () => {
    await drainAllPendingChunkEmbeddingJobs();

    const chunks = await findChunksByContract({ organizationId: org.id, contractId });
    for (const chunk of chunks) {
      const embedding = await findLatestEmbeddingForChunk(chunk.id);
      expect(embedding).not.toBeNull();
      expect(embedding!.dimension).toBe(VECTOR_NATIVE_DIMENSION);
      expect(embedding!.vector).toHaveLength(VECTOR_NATIVE_DIMENSION);
      expect(embedding!.isLatest).toBe(true);
    }

    const nativeRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "contract_document_chunk_embeddings"
      WHERE "organizationId" = ${org.id} AND "vectorNative" IS NOT NULL
    `;
    expect(Number(nativeRows[0]!.count)).toBe(chunks.length);

    const jobs = await prisma.contractDocumentChunkEmbeddingJob.findMany({ where: { organizationId: org.id } });
    expect(jobs.every((j) => j.status === "COMPLETED")).toBe(true);
  });

  it("re-scanning after processing finds nothing stale (idempotent, matches scanAndEnqueueStaleClauseEmbeddings' contract)", async () => {
    const result = await scanAndEnqueueStaleChunkEmbeddings(org.id);
    expect(result.enqueued).toBe(0);
  });
});
