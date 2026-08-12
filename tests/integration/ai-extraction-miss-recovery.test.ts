import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion } from "@/features/ai/server/ask-question";
import { createContract } from "@/features/contracts/server/create-contract";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-extraction-miss-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DISTINCTIVE_FACT = "위약금은 계약금액의 20%에 해당하는 금액으로 한다";

const SAMPLE_LINES = [
  "물품 공급계약서",
  "",
  "제1조(목적)",
  "본 계약은 물품의 공급에 관한 제반 사항을 정함을 목적으로 한다.",
  "",
  "제7조(위약금)",
  `일방 당사자가 본 계약을 위반한 경우 상대방에게 위약금을 지급하여야 한다. ${DISTINCTIVE_FACT}.`,
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
    if (!(await processNextExtractionJob(`extraction-miss-drain-extract-${attempt}`)).processed) return;
  }
}
async function drainAllPendingChunkEmbeddingJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextChunkEmbeddingJob(`extraction-miss-drain-chunk-embed-${attempt}`)).processed) return;
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Extraction Miss Test Org", slug: `ai-extraction-miss-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "AI Extraction Miss Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "추출 누락 복구 테스트 계약서", contractType: "SUPPLY", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "extraction-miss-test.docx",
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  await createExtractionJob({ userId: owner.id, organizationId: org.id, contractId, input: { contractFileId: uploaded.id } });
  await drainAllPendingExtractionJobs();
  // §Phase 14.1 §11 - deliberately NEVER run clause segmentation for this
  // contract. This is the cleanest, most direct way to construct a real
  // "extraction miss": ContractClause structurally has ZERO rows for this
  // contract (verified below), so any citation the pipeline finds for the
  // penalty fact MUST have come from the raw document chunk leg, never the
  // structured clause leg - proving "clause extraction failure != AI
  // knowledge failure" is actually true in the running system, not just
  // true by architecture-diagram assertion.
  await drainAllPendingChunkEmbeddingJobs();
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
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("§Phase 14.1 §11 - extraction-miss recovery via raw document chunk retrieval", () => {
  it("sanity check - ContractClause has ZERO rows for this contract (clause segmentation genuinely never ran)", async () => {
    const clauseCount = await prisma.contractClause.count({ where: { contractId } });
    expect(clauseCount).toBe(0);
  });

  it("sanity check - the raw document chunk containing the fact DOES exist and IS embedded", async () => {
    const chunks = await prisma.contractDocumentChunk.findMany({ where: { contractId } });
    expect(chunks.length).toBeGreaterThan(0);
    const factChunk = chunks.find((c) => c.text.includes(DISTINCTIVE_FACT));
    expect(factChunk).toBeDefined();

    const embedding = await prisma.contractDocumentChunkEmbedding.findFirst({
      where: { chunkId: factChunk!.id, isLatest: true },
    });
    expect(embedding).not.toBeNull();
  });

  it("retrieveContext finds the fact via a CHUNK citation - the clause leg structurally cannot contribute one", async () => {
    const citations = await retrieveContext({
      organizationId: org.id,
      question: "위약금은 얼마인가요?",
    });

    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((c) => c.evidenceType === "chunk")).toBe(true);

    const factCitation = citations.find((c) => c.evidenceText.includes("20%"));
    expect(factCitation).toBeDefined();
    expect(factCitation!.evidenceType).toBe("chunk");
  });

  it("askQuestion answers the question correctly, citing a real chunk (never a fabricated clause), with a valid provenance-carrying citation", async () => {
    const result = await askQuestion({ organizationId: org.id, question: "위약금은 얼마인가요?" });

    expect(result.sufficient).toBe(true);
    expect(result.answerText).toContain("20%");
    expect(result.answerText).toMatch(/\[출처:/);

    expect(result.citations.length).toBeGreaterThan(0);
    for (const citation of result.citations) {
      expect(citation.evidenceType).toBe("chunk");
      expect(citation.contractClauseId).toBeNull();
      if (citation.evidenceType === "chunk") {
        expect(citation.chunkId).toBeTruthy();
        expect(citation.chunkStartOffset).toBeGreaterThanOrEqual(0);
        expect(citation.chunkEndOffset).toBeGreaterThan(citation.chunkStartOffset);
      }
    }
  });
});
