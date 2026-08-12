import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion } from "@/features/ai/server/ask-question";
import { createContract } from "@/features/contracts/server/create-contract";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { searchDocumentChunkVectors } from "@/features/ai/server/search-document-chunk-vectors";
import { hybridSearchDocumentChunks } from "@/features/ai/server/hybrid-search-document-chunks";
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { findChunkKeywordMatchCounts } from "@/server/repositories/contract-document-chunk-keyword-match-repository";
import { findChunksByContract, findChunksByIds } from "@/server/repositories/contract-document-chunk-repository";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-chunk-tenant-isolation-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Byte-identical content across both organizations - the hardest possible
// confusability case for the chunk retrieval leg specifically (same text,
// same embedding, different tenant - see run-ai-evaluation.ts's own decoy
// org for the same rationale on the clause leg).
const SHARED_LINES = [
  "기밀유지 및 손해배상 계약서",
  "",
  "제9조(기밀유지 위반 시 손해배상)",
  "일방 당사자가 본 계약상 기밀유지 의무를 위반하여 상대방에게 손해를 끼친 경우, " +
    "위반 당사자는 상대방에게 발생한 손해를 배상하여야 하며 그 배상액은 위반행위로 인한 " +
    "실제 손해액을 기준으로 산정한다.",
];

interface OrgFixture {
  organizationId: string;
  ownerId: string;
  contractId: string;
  contractTitle: string;
}

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drainAllPendingExtractionJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextExtractionJob(`chunk-isolation-drain-extract-${attempt}`)).processed) return;
  }
}
async function drainAllPendingChunkEmbeddingJobs() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await processNextChunkEmbeddingJob(`chunk-isolation-drain-chunk-embed-${attempt}`)).processed) return;
  }
}

async function seedOrgWithSharedContent(label: string, emailSuffix: string): Promise<OrgFixture> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Chunk Tenant Isolation ${label} (${runId})`, slug: `chunk-isolation-${emailSuffix}-${runId}` },
  });
  const owner = await prisma.user.create({
    data: {
      name: `Chunk Isolation Owner ${label}`,
      email: `owner-${emailSuffix}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: organization.id, role: MembershipRole.OWNER } },
    },
  });

  const contractTitle = `${label} 기밀유지 계약서`;
  const contract = await createContract({
    userId: owner.id,
    organizationId: organization.id,
    input: { title: contractTitle, contractType: "NDA", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(SHARED_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    originalName: `chunk-isolation-${emailSuffix}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });

  await createExtractionJob({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    input: { contractFileId: uploaded.id },
  });
  await drainAllPendingExtractionJobs();
  await drainAllPendingChunkEmbeddingJobs();

  return { organizationId: organization.id, ownerId: owner.id, contractId: contract.id, contractTitle };
}

async function cleanupOrg(fixture: OrgFixture, storageKeys: string[]) {
  const storageDriver = getStorageDriver();
  for (const key of storageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractDocumentChunk.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractFile.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contract.deleteMany({ where: { id: fixture.contractId } });
  await prisma.membership.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.organization.delete({ where: { id: fixture.organizationId } });
}

let orgA: OrgFixture;
let orgB: OrgFixture;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  [orgA, orgB] = await Promise.all([
    seedOrgWithSharedContent("Org A", "a"),
    seedOrgWithSharedContent("Org B", "b"),
  ]);
}, 60_000);

afterAll(async () => {
  await cleanupOrg(orgA, []);
  await cleanupOrg(orgB, []);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

/**
 * §Phase 14.1 §17/§21 - RELEASE BLOCKER #1, extended to the new raw
 * document chunk retrieval pipeline. Both organizations here have
 * BYTE-IDENTICAL contract text (same embedding, same keyword-stem
 * matches, same normalized text) - the toughest confusability case at
 * every layer this attack surface has: DB repository lookups, vector
 * search (both pgvector and its application-cosine fallback path via
 * whichever provider AI_VECTOR_SEARCH_PROVIDER resolves to in this
 * environment), keyword search, hybrid fusion, retrieveContext's dual-leg
 * merge, and the final askQuestion() answer/citations actually built into
 * the LLM prompt.
 */
describe("§Security - chunk retrieval tenant isolation (Phase 14.1 §17/§21)", () => {
  it("DB layer - findChunksByIds never returns another organization's chunks, even given their real ids", async () => {
    const orgBChunks = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgB.contractId });
    expect(orgBChunks.length).toBeGreaterThan(0);
    const orgBChunkIds = orgBChunks.map((c) => c.id);

    const attempted = await findChunksByIds({ organizationId: orgA.organizationId, chunkIds: orgBChunkIds });
    expect(attempted).toEqual([]);
  });

  it("keyword search - Org A's ILIKE match never returns Org B's chunk ids, despite identical text", async () => {
    const orgBChunks = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgB.contractId });
    const orgBChunkIds = new Set(orgBChunks.map((c) => c.id));

    const matches = await findChunkKeywordMatchCounts(orgA.organizationId, ["기밀유지", "손해배상"]);
    for (const chunkId of matches.keys()) {
      expect(orgBChunkIds.has(chunkId)).toBe(false);
    }
  });

  it("vector search - Org A's query never returns Org B's chunk id, even for byte-identical embeddings", async () => {
    const embeddingProvider = getEmbeddingProvider();
    const queryEmbedding = await embeddingProvider.generateEmbedding("기밀유지 의무를 위반하면 손해배상 책임이 있나요?");

    const orgBChunks = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgB.contractId });
    const orgBChunkIds = new Set(orgBChunks.map((c) => c.id));

    const candidates = await searchDocumentChunkVectors({
      organizationId: orgA.organizationId,
      queryVector: queryEmbedding.vector,
      embeddingProvider: embeddingProvider.providerName,
      embeddingModel: embeddingProvider.modelName,
      topK: 20,
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(orgBChunkIds.has(candidate.chunkId)).toBe(false);
      expect(candidate.contractTitle).toBe(orgA.contractTitle);
    }
  });

  it("hybrid fusion (chunk leg) - never returns Org B's chunks for Org A's identical-content question", async () => {
    const orgBChunks = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgB.contractId });
    const orgBChunkIds = new Set(orgBChunks.map((c) => c.id));

    const results = await hybridSearchDocumentChunks({
      organizationId: orgA.organizationId,
      question: "기밀유지 위반 시 손해배상 책임은 어떻게 되나요?",
      topK: 20,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(orgBChunkIds.has(result.chunkId)).toBe(false);
      expect(result.contractId).toBe(orgA.contractId);
    }
  });

  it("retrieveContext (dual-leg) - a FOCUSED question never leaks Org B chunk/clause citations into Org A's context", async () => {
    const citations = await retrieveContext({
      organizationId: orgA.organizationId,
      question: "기밀유지 위반 시 손해배상 책임은 어떻게 되나요?",
    });
    expect(citations.length).toBeGreaterThan(0);
    for (const citation of citations) {
      expect(citation.contractId).toBe(orgA.contractId);
      expect(citation.contractTitle).toBe(orgA.contractTitle);
    }
  });

  it("retrieveContext (dual-leg) - a COMPREHENSIVE question (wider topK, §15) still never leaks Org B content into Org A's context", async () => {
    const citations = await retrieveContext({
      organizationId: orgA.organizationId,
      question: "이 계약의 위험 조항을 모두 검토해줘",
    });
    for (const citation of citations) {
      expect(citation.contractId).toBe(orgA.contractId);
      expect(citation.contractTitle).toBe(orgA.contractTitle);
    }
  });

  it("askQuestion end-to-end - the final answer text and every citation are exclusively Org A's, never Org B's, despite identical source content", async () => {
    const result = await askQuestion({
      organizationId: orgA.organizationId,
      question: "기밀유지 위반 시 손해배상 책임은 어떻게 되나요?",
    });
    expect(result.sufficient).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    for (const citation of result.citations) {
      expect(citation.contractId).toBe(orgA.contractId);
      expect(citation.contractTitle).toBe(orgA.contractTitle);
      expect(citation.contractTitle).not.toBe(orgB.contractTitle);
    }
    // The prompt is built exclusively from `result.citations` - since none
    // of them reference Org B, Org B's contract title can never have
    // reached the LLM prompt for this request either (leakage into the
    // PROMPT, not just the final HTTP response, is what this whole file
    // guards against - see citation loop above, which is the actual
    // upstream guarantee this assertion restates for the answer text).
    expect(result.answerText).not.toContain(orgB.contractTitle);
  });

  it("cache isolation - Org A and Org B each get their own chunk-retrieval cache entry for the identical question text, never a cross-org cache hit", async () => {
    const question = "기밀유지 위반 시 손해배상 책임은 어떻게 되나요?";
    const [resultsA, resultsB] = await Promise.all([
      hybridSearchDocumentChunks({ organizationId: orgA.organizationId, question, topK: 10 }),
      hybridSearchDocumentChunks({ organizationId: orgB.organizationId, question, topK: 10 }),
    ]);
    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsB.length).toBeGreaterThan(0);
    expect(resultsA.every((r) => r.contractId === orgA.contractId)).toBe(true);
    expect(resultsB.every((r) => r.contractId === orgB.contractId)).toBe(true);

    // Re-run Org A's query (now a real cache hit for the retrieval cache)
    // and confirm the cached result is STILL exclusively Org A's.
    const resultsARepeat = await hybridSearchDocumentChunks({
      organizationId: orgA.organizationId,
      question,
      topK: 10,
    });
    expect(resultsARepeat.every((r) => r.contractId === orgA.contractId)).toBe(true);
  });

  it("§Injection defense - a crafted organizationId string never widens the query beyond the caller's own organization (parameterized query, not string-built SQL)", async () => {
    const maliciously_crafted = `${orgA.organizationId}' OR '1'='1`;
    const results = await hybridSearchDocumentChunks({
      organizationId: maliciously_crafted,
      question: "기밀유지 위반 시 손해배상 책임은 어떻게 되나요?",
      topK: 20,
    });
    // A non-existent organizationId (even one shaped like an injection
    // payload) must behave exactly like any other unknown org: zero
    // results, never an error, never another organization's data.
    expect(results).toEqual([]);
  });
});
