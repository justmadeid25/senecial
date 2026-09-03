import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion, askQuestionStreaming } from "@/features/ai/server/ask-question";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-citation-precision-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * §AI 답변 품질 개편 Phase 1.4 - a small fixture (a handful of SHORT
 * articles) is deliberate: document-chunker.ts groups content by token
 * size, so a small contract like this reliably lands entirely in ONE
 * ContractDocumentChunk - guaranteeing that asking about any one article
 * retrieves BOTH a clause citation AND a chunk citation covering it (the
 * exact clause/chunk overlap this test needs to exercise, not something
 * a synthetic Citation[] alone could prove is actually wired end-to-end).
 */
const CONTRACT_LINES = [
  "인용 정밀도 테스트 계약서",
  "",
  "제1조(목적)",
  "본 계약은 발주자와 수행자 간 용역 수행에 관한 사항을 정한다.",
  "",
  "제2조(대금지급)",
  "발주자는 수행자에게 매월 말일 대금을 지급한다.",
  "",
  "제3조(비밀유지)",
  "양 당사자는 취득한 상대방의 영업비밀을 제3자에게 누설하지 아니한다.",
];

let org: { id: string };
let owner: { id: string };
let contractId: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(fn: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await fn(`citation-precision-${label}-${attempt}`)).processed) return;
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Citation Precision Test Org", slug: `ai-citation-precision-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Citation Precision Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "인용 정밀도 테스트 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(CONTRACT_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "citation-precision-test.docx",
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
  await drain(processNextExtractionJob, "extract");

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, "segment");
  await drain(processNextEmbeddingJob, "embed");
  await drain(processNextChunkEmbeddingJob, "chunk-embed");
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractDocumentChunk.deleteMany({ where: { contractId } });
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractClause.deleteMany({ where: { contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
  await prisma.contractFile.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

function articleNumbersOf(citations: readonly { clauseReference: string }[]): string[] {
  return citations.map((c) => c.clauseReference.match(/^제\s*\d+\s*조/)?.[0]?.replace(/\s+/g, "") ?? c.clauseReference);
}

describe("§AI 답변 품질 개편 Phase 1.4 - citation precision wired end-to-end through the real pipeline", () => {
  it("sanity - this small fixture really does produce a clause+chunk pair covering the same article (the exact overlap the fix targets)", async () => {
    const clauses = await prisma.contractClause.findMany({ where: { contractId } });
    const chunks = await prisma.contractDocumentChunk.findMany({ where: { contractId } });
    expect(clauses.length).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(0);
    // The whole point of using tiny articles: at least one chunk's text spans more than one article.
    const spanning = chunks.some((c) => (c.text.match(/제\d+조/g)?.length ?? 0) > 1);
    expect(spanning).toBe(true);
  });

  it("askQuestion()'s citations never contain the same article number twice, even though the development provider echoes every supplied context citation (clause AND chunk legs both match)", async () => {
    const result = await askQuestion({ organizationId: org.id, question: "대금은 언제 지급돼?", contractId });
    expect(result.sufficient).toBe(true);

    const articles = articleNumbersOf(result.citations);
    expect(new Set(articles).size).toBe(articles.length);
    // The real regression this fix targets: a duplicate representation
    // (clause "제2조" + chunk "제2조(대금지급)") of the SAME provision must
    // collapse to exactly one entry, never render as two.
    expect(articles.filter((a) => a === "제2조")).toHaveLength(1);
  });

  it("askQuestion()'s citations are a SUBSET of (never larger than) what was actually retrieved - answer-used, not merely retrieved", async () => {
    const result = await askQuestion({ organizationId: org.id, question: "비밀유지 의무 있어?", contractId });
    expect(result.sufficient).toBe(true);
    for (const citation of result.citations) {
      expect(citation.contractId).toBe(contractId);
    }
  });

  it("askQuestionStreaming()'s final \"done\" event citations match the deduplicated, answer-used set - not the early \"citations\" event's broader retrieved set", async () => {
    const events: { type: string; citations?: unknown[] }[] = [];
    for await (const event of askQuestionStreaming({ organizationId: org.id, question: "대금은 언제 지급돼?", contractId })) {
      events.push(event as { type: string; citations?: unknown[] });
    }

    const citationsEvent = events.find((e) => e.type === "citations");
    const doneEvent = events.find((e) => e.type === "done");
    expect(citationsEvent).toBeDefined();
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.citations).toBeDefined();

    const doneArticles = articleNumbersOf(doneEvent!.citations as { clauseReference: string }[]);
    expect(new Set(doneArticles).size).toBe(doneArticles.length);
    expect(doneArticles.filter((a) => a === "제2조")).toHaveLength(1);
  });
});
