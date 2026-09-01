import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import { hybridSearchDocumentChunks } from "@/features/ai/server/hybrid-search-document-chunks";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-contract-scoping-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Deliberately near-identical clause/chunk content across both contracts
// (same termination-clause wording, same keyword stems, near-identical
// embedding) - the hardest possible confusability case for contractId
// scoping specifically, mirroring this codebase's existing "identical
// content" discipline for ORG isolation (see
// tests/integration/ai-chunk-tenant-isolation.test.ts's SHARED_LINES /
// tests/integration/ai-prompt-cache-tenant-isolation.test.ts's shared
// CONTRACT_TITLE). Without a real, working contractId filter, a query
// scoped to one contract would very plausibly still surface the other's
// near-identical clause via keyword/vector match alone.
const CONTRACT_A_TITLE_LINE = "계약 범위 지정 테스트 - 계약 A";
const CONTRACT_B_TITLE_LINE = "계약 범위 지정 테스트 - 계약 B";
const SHARED_TERMINATION_TEXT =
  "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.";

const CONTRACT_A_LINES = [CONTRACT_A_TITLE_LINE, "", "제1조(계약 해지)", SHARED_TERMINATION_TEXT];
const CONTRACT_B_LINES = [CONTRACT_B_TITLE_LINE, "", "제1조(계약 해지)", SHARED_TERMINATION_TEXT];

interface ContractFixture {
  contractId: string;
  contractTitle: string;
}

let organizationId: string;
let ownerId: string;
let contractA: ContractFixture;
let contractB: ContractFixture;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(fn: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await fn(`contract-scoping-${label}-${attempt}`)).processed) return;
  }
}

async function seedContract(label: string, title: string, lines: string[]): Promise<ContractFixture> {
  const created = await createContract({
    userId: ownerId,
    organizationId,
    input: { title, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId: ownerId,
    organizationId,
    contractId: created.id,
    originalName: `contract-scoping-${label}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: ownerId,
    organizationId,
    contractId: created.id,
    input: { contractFileId: uploaded.id },
  });
  await drain(processNextExtractionJob, `${label}-extract`);
  await drain(processNextChunkEmbeddingJob, `${label}-chunk-embed`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: ownerId,
    organizationId,
    contractId: created.id,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${label}-segment`);
  await drain(processNextEmbeddingJob, `${label}-embed`);

  return { contractId: created.id, contractTitle: title };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  const organization = await prisma.organization.create({
    data: { name: "Contract Scoping Test Org", slug: `ai-contract-scoping-test-${Date.now()}` },
  });
  organizationId = organization.id;
  const owner = await prisma.user.create({
    data: {
      name: "Contract Scoping Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId, role: MembershipRole.OWNER } },
    },
  });
  ownerId = owner.id;

  contractA = await seedContract("a", "계약 A", CONTRACT_A_LINES);
  contractB = await seedContract("b", "계약 B", CONTRACT_B_LINES);
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunk.deleteMany({ where: { organizationId } });
  await prisma.contractClause.deleteMany({ where: { organizationId } });
  await prisma.contractSection.deleteMany({ where: { organizationId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId } });
  await prisma.contract.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

const QUESTION = "계약을 해지하려면 어떻게 해야 하나요?";

describe("§AI 상담 개편 - hybridSearchClauses contract scoping", () => {
  it("without contractId, both contracts' near-identical termination clauses are eligible (sanity - proves the fixture is genuinely confusable)", async () => {
    const results = await hybridSearchClauses({ organizationId, question: QUESTION, topK: 10 });
    const contractIds = new Set(results.map((r) => r.contractId));
    expect(contractIds.has(contractA.contractId)).toBe(true);
    expect(contractIds.has(contractB.contractId)).toBe(true);
  });

  it("scoped to contractA, every result belongs to contractA - contractB's near-identical clause never appears", async () => {
    const results = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.contractId).toBe(contractA.contractId);
    }
  });

  it("scoped to contractB, every result belongs to contractB - contractA's near-identical clause never appears", async () => {
    const results = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractB.contractId,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.contractId).toBe(contractB.contractId);
    }
  });
});

describe("§AI 상담 개편 - hybridSearchDocumentChunks contract scoping", () => {
  it("without contractId, both contracts' near-identical chunks are eligible (sanity)", async () => {
    const results = await hybridSearchDocumentChunks({ organizationId, question: QUESTION, topK: 10 });
    const contractIds = new Set(results.map((r) => r.contractId));
    expect(contractIds.has(contractA.contractId)).toBe(true);
    expect(contractIds.has(contractB.contractId)).toBe(true);
  });

  it("scoped to contractA, every chunk result belongs to contractA - contractB's near-identical chunk never appears", async () => {
    const results = await hybridSearchDocumentChunks({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.contractId).toBe(contractA.contractId);
    }
  });

  it("scoped to contractB, every chunk result belongs to contractB - contractA's near-identical chunk never appears", async () => {
    const results = await hybridSearchDocumentChunks({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractB.contractId,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.contractId).toBe(contractB.contractId);
    }
  });
});

describe("§AI 상담 개편 - retrieval cache isolation across contract scope (real cache, not just the key builder)", () => {
  it("clause retrieval - a contractA-scoped result is never served back for an unscoped or contractB-scoped request with the identical question", async () => {
    const scopedA = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(scopedA.every((r) => r.contractId === contractA.contractId)).toBe(true);

    // Same org + question, no contractId: if the cache key ignored
    // contractId, this would incorrectly reuse contractA's cached
    // (contractA-only) result instead of computing the real unscoped set.
    const unscoped = await hybridSearchClauses({ organizationId, question: QUESTION, topK: 10 });
    const unscopedContractIds = new Set(unscoped.map((r) => r.contractId));
    expect(unscopedContractIds.has(contractB.contractId)).toBe(true);

    // Same org + question, scoped to contractB: must never come back as
    // contractA's cached entry either.
    const scopedB = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractB.contractId,
    });
    expect(scopedB.every((r) => r.contractId === contractB.contractId)).toBe(true);
  });

  it("chunk retrieval - a contractA-scoped result is never served back for an unscoped or contractB-scoped request with the identical question", async () => {
    const scopedA = await hybridSearchDocumentChunks({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(scopedA.every((r) => r.contractId === contractA.contractId)).toBe(true);

    const unscoped = await hybridSearchDocumentChunks({ organizationId, question: QUESTION, topK: 10 });
    const unscopedContractIds = new Set(unscoped.map((r) => r.contractId));
    expect(unscopedContractIds.has(contractB.contractId)).toBe(true);

    const scopedB = await hybridSearchDocumentChunks({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractB.contractId,
    });
    expect(scopedB.every((r) => r.contractId === contractB.contractId)).toBe(true);
  });

  it("re-running the exact same scoped query (now a real cache hit) still returns only that contract's results", async () => {
    const first = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    const second = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(second.every((r) => r.contractId === contractA.contractId)).toBe(true);
    expect(second.map((r) => r.contractClauseId)).toEqual(first.map((r) => r.contractClauseId));
  });
});

describe("§AI 상담 개편 - clause evidence eligibility (preamble pseudo-clause exclusion)", () => {
  it("the segmenter's implicit preamble clause (no clauseNumber, no title) exists in the DB for contractA - sanity that the fixture actually produced one", async () => {
    const preamble = await prisma.contractClause.findFirst({
      where: { contractId: contractA.contractId, clauseNumber: null, title: null },
    });
    expect(preamble).not.toBeNull();
    expect(preamble!.text).toContain(CONTRACT_A_TITLE_LINE);
  });

  it("a question matching the preamble's own text never returns it as a citation, even scoped to contractA where it is the only candidate", async () => {
    // "지정" (the second word of the title line) is not present anywhere
    // else in contractA's real clause ("계약 해지" clause) - a keyword
    // match against it can only come from the preamble text itself.
    const results = await hybridSearchClauses({
      organizationId,
      question: "계약 범위 지정",
      topK: 10,
      contractId: contractA.contractId,
    });
    for (const result of results) {
      expect(result.clauseNumber).not.toBeNull();
    }
  });

  it("the real §1조 termination clause remains eligible and is returned for its own question (the filter excludes only the pseudo-clause, not real content)", async () => {
    const results = await hybridSearchClauses({
      organizationId,
      question: QUESTION,
      topK: 10,
      contractId: contractA.contractId,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.clauseNumber === "제1조")).toBe(true);
  });
});
