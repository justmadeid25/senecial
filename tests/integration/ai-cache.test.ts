import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import { askQuestion } from "@/features/ai/server/ask-question";
import { getLatestEmbeddingGenerationChecksum } from "@/server/repositories/clause-embedding-repository";
import { renderPrometheusMetrics } from "@/server/monitoring/metrics";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-cache-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let org: { id: string };
let owner: { id: string };
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drainAllPendingExtractionJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextExtractionJob(`drain-extract-${attempt}`)).processed) return;
  }
}
async function drainAllPendingSegmentationJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextClauseSegmentationJob(`drain-seg-${attempt}`)).processed) return;
  }
}
async function drainAllPendingEmbeddingJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextEmbeddingJob(`drain-embed-${attempt}`)).processed) return;
  }
}

async function uploadAndProcessContract(title: string, lines: string[]) {
  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId: created.id,
    originalName: `${title}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: org.id,
    contractId: created.id,
    input: { contractFileId: uploaded.id },
  });
  await drainAllPendingExtractionJobs();

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });

  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: org.id,
    contractId: created.id,
    input: { extractedDocumentId: document.id },
  });
  await drainAllPendingSegmentationJobs();
  await drainAllPendingEmbeddingJobs();

  return created.id;
}

function cacheHitCount(cacheName: string): number {
  const output = renderPrometheusMetrics();
  const match = output.match(new RegExp(`clausebase_ai_cache_hits_total\\{cache="${cacheName}"\\} (\\d+)`));
  return match ? Number(match[1]) : 0;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Cache Test Org", slug: `ai-cache-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "AI Cache Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  await uploadAndProcessContract("AI 캐시 테스트 계약서", [
    "제1조(계약 해지)",
    "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
  ]);
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractClause.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractSection.deleteMany({ where: { organizationId: org.id } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contract.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("§Cache (Phase 12 Part N, real end-to-end)", () => {
  it("caches the query embedding independently of the retrieval cache - a different topK (retrieval cache MISS) for the same question text still hits the embedding cache", async () => {
    // topK differs between the two calls so the OUTER retrieval cache
    // (keyed by organizationId+question+topK) cannot itself serve the
    // second call - isolating this test to the embedding cache alone,
    // which is keyed by normalized question text only.
    const question = "계약을 해지하려면 어떻게 해야 하나요?";
    const before = cacheHitCount("embedding");

    await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    const afterFirst = cacheHitCount("embedding");

    await hybridSearchClauses({ organizationId: org.id, question, topK: 3 });
    const afterSecond = cacheHitCount("embedding");

    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(afterFirst).toBeGreaterThanOrEqual(before);
  });

  it("caches the full retrieval result - identical results on a cache hit", async () => {
    const question = "영업비밀 누설 금지 조항이 있나요?";
    const before = cacheHitCount("retrieval");

    const first = await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    const afterFirst = cacheHitCount("retrieval");

    const second = await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    const afterSecond = cacheHitCount("retrieval");

    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(afterFirst).toBeGreaterThanOrEqual(before);
    expect(second.map((r) => r.contractClauseId)).toEqual(first.map((r) => r.contractClauseId));
  });

  it("§checksum invalidation - a retrieval cache entry is never honored after the organization's embedding set changes", async () => {
    const question = "대금은 언제 지급되나요?";
    const checksumBefore = await getLatestEmbeddingGenerationChecksum(org.id);

    const firstResults = await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    const hitsAfterFirst = cacheHitCount("retrieval");

    // A second identical call right away should be a cache hit (checksum unchanged).
    await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    expect(cacheHitCount("retrieval")).toBeGreaterThan(hitsAfterFirst);

    // Now genuinely change the organization's embedding set by adding a new contract/clause.
    await uploadAndProcessContract("AI 캐시 테스트 계약서 2", [
      "제1조(대금지급)",
      "발주자는 용역 완료 후 30일 이내에 대금을 지급하여야 한다.",
    ]);
    const checksumAfter = await getLatestEmbeddingGenerationChecksum(org.id);
    expect(checksumAfter).not.toBe(checksumBefore);

    const hitsBeforeThirdCall = cacheHitCount("retrieval");
    const thirdResults = await hybridSearchClauses({ organizationId: org.id, question, topK: 5 });
    // The stale cache entry must be rejected (not counted as a hit) even though the key is identical.
    expect(cacheHitCount("retrieval")).toBe(hitsBeforeThirdCall);
    // And the new, more relevant clause should now actually be found.
    expect(thirdResults.some((r) => r.text.includes("대금"))).toBe(true);
    expect(thirdResults.map((r) => r.contractClauseId)).not.toEqual(firstResults.map((r) => r.contractClauseId));
  });

  it("caches the LLM completion - a repeated question returns the identical answer via a prompt cache hit", async () => {
    const question = "계약을 해지하려면 어떻게 해야 하나요?";
    const before = cacheHitCount("prompt");

    const first = await askQuestion({ organizationId: org.id, question });
    const afterFirst = cacheHitCount("prompt");

    const second = await askQuestion({ organizationId: org.id, question });
    const afterSecond = cacheHitCount("prompt");

    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(afterFirst).toBeGreaterThanOrEqual(before);
    expect(second.answerText).toBe(first.answerText);
  });
});
