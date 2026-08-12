import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion } from "@/features/ai/server/ask-question";
import { buildPromptMessages } from "@/domain/ai/prompt-builder";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import { hybridSearchDocumentChunks } from "@/features/ai/server/hybrid-search-document-chunks";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { addMessage, createConversation, listMessagesForConversation } from "@/server/repositories/ai-conversation-repository";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-revision-freshness-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const V1_MARKER = "계약 종료일은 2027년 12월 31일이다";
const V2_MARKER = "계약 종료일은 2029년 12월 31일이다";
const QUESTION = "이 계약은 언제 끝나?";

let org: { id: string };
let owner: { id: string };
let contractId: string;
let contractTitle: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
async function drain(fn: (id: string) => Promise<{ processed: boolean }>, label: string) {
  for (let i = 0; i < 60; i++) if (!(await fn(`revision-freshness-${label}-${i}`)).processed) return;
}

async function uploadExtractSegmentEmbed(lines: string[], suffix: string) {
  const buffer = await buildDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: `revision-freshness-${suffix}.docx`,
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
  await drain(processNextExtractionJob, `${suffix}-extract`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${suffix}-segment`);
  await drain(processNextEmbeddingJob, `${suffix}-embed`);
  await drain(processNextChunkEmbeddingJob, `${suffix}-chunk-embed`);

  return document.id;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Revision Freshness Test Org", slug: `ai-revision-freshness-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Revision Freshness Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
  contractTitle = "재추출 신선도 계약서";
  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: contractTitle, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.message.deleteMany({ where: { organizationId: org.id } });
  await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
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

describe("§Phase 14.2 - re-extraction acceptance: V1 -> V2 excludes V1 everywhere", () => {
  it("V1 upload/extraction/chunk/clause/embedding, real pipeline, real fact present", async () => {
    await uploadExtractSegmentEmbed(["제1조(계약기간)", `${V1_MARKER}.`], "v1");
    const clauseResults = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(clauseResults.some((r) => r.text.includes(V1_MARKER))).toBe(true);
  });

  it("V2 upload/extraction/chunk/clause/embedding for the SAME contract (real re-upload, not a DB row edit)", async () => {
    await uploadExtractSegmentEmbed(["제1조(계약기간)", `${V2_MARKER}.`], "v2");

    // Sanity - both extractions really happened (2 real ContractExtractedDocument rows).
    const documentCount = await prisma.contractExtractedDocument.count({ where: { contractId } });
    expect(documentCount).toBe(2);
  });

  it("clause candidates: V1 = 0, V2 only", async () => {
    const results = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(results.some((r) => r.text.includes(V1_MARKER))).toBe(false);
    expect(results.some((r) => r.text.includes(V2_MARKER))).toBe(true);
  });

  it("chunk candidates: V1 = 0, V2 only", async () => {
    const results = await hybridSearchDocumentChunks({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(results.some((r) => r.text.includes(V1_MARKER))).toBe(false);
    expect(results.some((r) => r.text.includes(V2_MARKER))).toBe(true);
  });

  it("packed context (retrieveContext) contains zero V1 text", async () => {
    const citations = await retrieveContext({ organizationId: org.id, question: QUESTION });
    expect(citations.some((c) => c.evidenceText.includes(V1_MARKER))).toBe(false);
    expect(citations.some((c) => c.evidenceText.includes(V2_MARKER))).toBe(true);

    // The actual prompt text built from these citations - zero V1 leakage into the LLM prompt itself.
    const messages = buildPromptMessages(QUESTION, citations);
    for (const message of messages) {
      expect(message.content).not.toContain(V1_MARKER);
    }
  });

  it("final citation count: 0 V1 citations, final answer cites 2029", async () => {
    const result = await askQuestion({ organizationId: org.id, question: QUESTION });
    expect(result.sufficient).toBe(true);
    expect(result.answerText).toContain("2029");
    expect(result.answerText).not.toContain("2027");
    for (const citation of result.citations) {
      expect(citation.evidenceText).not.toContain(V1_MARKER);
    }
  });

  it("still true under a cache HIT (repeated identical question)", async () => {
    const result = await askQuestion({ organizationId: org.id, question: QUESTION });
    expect(result.answerText).toContain("2029");
    expect(result.answerText).not.toContain("2027");
  });
});

describe("§Phase 14.2 §12 - re-extraction cache invalidation", () => {
  it("a cached V1 result never resurfaces after a NEW successful extraction changes the authoritative revision", async () => {
    // This contract already went through V1 -> V2 above; warm the cache once more for V2, then
    // add a THIRD revision and confirm V2's cached result does not leak into V3's answer.
    const v2Cached = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(v2Cached.some((r) => r.text.includes(V2_MARKER))).toBe(true);

    const V3_MARKER = "계약 종료일은 2031년 12월 31일이다";
    await uploadExtractSegmentEmbed(["제1조(계약기간)", `${V3_MARKER}.`], "v3");

    const v3Results = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(v3Results.some((r) => r.text.includes(V2_MARKER))).toBe(false);
    expect(v3Results.some((r) => r.text.includes(V3_MARKER))).toBe(true);

    const chunkResults = await hybridSearchDocumentChunks({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(chunkResults.some((r) => r.text.includes(V2_MARKER))).toBe(false);
    expect(chunkResults.some((r) => r.text.includes(V3_MARKER))).toBe(true);
  });
});

describe("§Phase 14.2 §15 - historical citation provenance survives a later re-extraction", () => {
  it("a MessageCitation persisted while V1/V2 was authoritative is untouched by a later re-extraction, while NEW retrieval only ever sees the newest revision", async () => {
    // Persist a historical citation referencing V2's contractTitle/evidence
    // (the CURRENT revision at this point in the test file's own timeline
    // is V3 - deliberately persisting a citation for the NOW-superseded V2
    // fact simulates a real historical conversation from when V2 was current).
    const conversation = await createConversation({ organizationId: org.id, userId: owner.id });
    await addMessage({
      conversationId: conversation.id,
      organizationId: org.id,
      role: "ASSISTANT",
      content: `이 계약은 2029년에 종료됩니다. [출처: 제1조 - ${contractTitle}]`,
      citations: [
        {
          contractClauseId: "historical-v2-clause-id",
          chunkId: null,
          contractId,
          contractTitle,
          clauseNumber: "제1조",
          evidenceText: V2_MARKER,
          score: 0.9,
          sourcePageStart: null,
          sourcePageEnd: null,
          chunkStartOffset: null,
          chunkEndOffset: null,
        },
      ],
    });

    // A brand-new question right now must only ever see V3 (the current authoritative revision).
    const freshResult = await askQuestion({ organizationId: org.id, question: QUESTION });
    expect(freshResult.answerText).toContain("2031");
    expect(freshResult.answerText).not.toContain("2029");

    // The HISTORICAL MessageCitation row itself must remain exactly as persisted - never rewritten,
    // never deleted, never "corrected" to match the new revision.
    const messages = await listMessagesForConversation({
      organizationId: org.id,
      userId: owner.id,
      conversationId: conversation.id,
    });
    const historicalCitation = messages[0]!.citations[0]!;
    expect(historicalCitation.evidenceText).toBe(V2_MARKER);
    expect(historicalCitation.contractTitle).toBe(contractTitle);
  });
});

describe("§Phase 14.2 §16 - clause/raw revision alignment", () => {
  it("both legs reference the SAME latest authoritative extraction after a clean re-extraction (no lag scenario)", async () => {
    const clauseResults = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    const chunkResults = await hybridSearchDocumentChunks({ organizationId: org.id, question: QUESTION, topK: 20 });

    const V3_MARKER = "계약 종료일은 2031년 12월 31일이다";
    expect(clauseResults.every((r) => !r.text.includes(V1_MARKER) && !r.text.includes(V2_MARKER))).toBe(true);
    expect(chunkResults.every((r) => !r.text.includes(V1_MARKER) && !r.text.includes(V2_MARKER))).toBe(true);
    expect(clauseResults.some((r) => r.text.includes(V3_MARKER))).toBe(true);
    expect(chunkResults.some((r) => r.text.includes(V3_MARKER))).toBe(true);
  });
});
