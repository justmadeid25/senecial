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
import { searchDocumentChunkVectors } from "@/features/ai/server/search-document-chunk-vectors";
import { findChunkKeywordMatchCounts } from "@/server/repositories/contract-document-chunk-keyword-match-repository";
import { findChunksByContract, findChunksByIds } from "@/server/repositories/contract-document-chunk-repository";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { addMessage, createConversation, findConversationById, listMessagesForConversation } from "@/server/repositories/ai-conversation-repository";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-release-gate-audit.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const CANARY = "TENANT_A_SECRET_CANARY_9F3D7B21";

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
async function drain(fn: (id: string) => Promise<{ processed: boolean }>, label: string) {
  for (let i = 0; i < 60; i++) if (!(await fn(`audit-${label}-${i}`)).processed) return;
}

async function seedOrg(label: string, suffix: string, lines: string[]): Promise<OrgFixture> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Release Gate Audit ${label} (${runId})`, slug: `release-gate-audit-${suffix}-${runId}` },
  });
  const owner = await prisma.user.create({
    data: {
      name: `Release Gate Audit Owner ${label}`,
      email: `owner-${suffix}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: organization.id, role: MembershipRole.OWNER } },
    },
  });
  const contractTitle = `${label} 감사 계약서`;
  const contract = await createContract({
    userId: owner.id,
    organizationId: organization.id,
    input: { title: contractTitle, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(lines);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    originalName: `release-gate-audit-${suffix}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });

  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    input: { contractFileId: uploaded.id },
  });
  await drain(processNextExtractionJob, `${suffix}-extract`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: organization.id,
    contractId: contract.id,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${suffix}-segment`);
  await drain(processNextEmbeddingJob, `${suffix}-embed`);
  await drain(processNextChunkEmbeddingJob, `${suffix}-chunk-embed`);

  return { organizationId: organization.id, ownerId: owner.id, contractId: contract.id, contractTitle };
}

async function cleanupOrg(fixture: OrgFixture) {
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractDocumentChunk.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.contractClause.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: fixture.contractId } });
  await prisma.message.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.conversation.deleteMany({ where: { organizationId: fixture.organizationId } });
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
    seedOrg("Org A", "a", [
      "제1조(비밀유지)",
      `양 당사자는 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다. 참고 코드: ${CANARY}.`,
      "",
      "제2조(손해배상)",
      "일방의 귀책사유로 손해가 발생한 경우 그 손해를 배상하여야 한다.",
    ]),
    seedOrg("Org B", "b", [
      "제1조(비밀유지)",
      "양 당사자는 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
      "",
      "제2조(손해배상)",
      "일방의 귀책사유로 손해가 발생한 경우 그 손해를 배상하여야 한다.",
    ]),
  ]);
}, 90_000);

afterAll(async () => {
  await cleanupOrg(orgA);
  await cleanupOrg(orgB);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("§Phase 14.1 Release Gate Audit - wrong-contractId attack", () => {
  it("Org B's session, Org A's real contractId - the chunk repository never returns Org A's data", async () => {
    const attempted = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgA.contractId });
    expect(attempted).toEqual([]);
  });

  it("Org B's session, Org A's real chunk ids (obtained via Org A's own session) - findChunksByIds returns nothing", async () => {
    const orgAChunks = await findChunksByContract({ organizationId: orgA.organizationId, contractId: orgA.contractId });
    expect(orgAChunks.length).toBeGreaterThan(0);
    const attempted = await findChunksByIds({ organizationId: orgB.organizationId, chunkIds: orgAChunks.map((c) => c.id) });
    expect(attempted).toEqual([]);
  });

  it("Org B's session, Org A's real contractId - clause data never returned either (pre-existing clause-side invariant, still holds)", async () => {
    const attempted = await prisma.contractClause.findMany({
      where: { organizationId: orgB.organizationId, contractId: orgA.contractId },
    });
    expect(attempted).toEqual([]);
  });
});

describe("§Phase 14.1 Release Gate Audit - reranker/fusion cannot reintroduce a foreign-org candidate", () => {
  it("hydration (the same query shape hybrid-search-document-chunks.ts uses) rejects a MIXED id list containing both a legitimate and a foreign chunk id", async () => {
    const orgAChunks = await findChunksByContract({ organizationId: orgA.organizationId, contractId: orgA.contractId });
    const orgBChunks = await findChunksByContract({ organizationId: orgB.organizationId, contractId: orgB.contractId });
    const mixedIds = [orgAChunks[0]!.id, orgBChunks[0]!.id];

    // The exact hydration shape used by the real retrieval hot path -
    // simulating a hypothetical compromised earlier stage that somehow
    // mixed a foreign id into the candidate set. Even then, the org filter
    // on THIS query is what actually decides what comes back.
    const hydrated = await prisma.contractDocumentChunk.findMany({
      where: { id: { in: mixedIds }, organizationId: orgA.organizationId },
    });
    expect(hydrated.map((c) => c.id)).toEqual([orgAChunks[0]!.id]);
  });

  it("the real retrieval entry point never surfaces a foreign candidate even under maximum topK widening (comprehensive question)", async () => {
    const results = await hybridSearchDocumentChunks({
      organizationId: orgA.organizationId,
      question: "이 계약에서 위험하거나 불리할 수 있는 내용을 모두 찾아줘",
      topK: 50,
    });
    for (const result of results) {
      expect(result.contractId).toBe(orgA.contractId);
    }
  });
});

describe("§Phase 14.1 Release Gate Audit - conversation scope attack", () => {
  it("a DIFFERENT organization can never read Org A's conversation, even knowing its real conversationId - including the CHUNK citation provenance added in this audit", async () => {
    const conversation = await createConversation({ organizationId: orgA.organizationId, userId: orgA.ownerId });
    await addMessage({ conversationId: conversation.id, organizationId: orgA.organizationId, role: "USER", content: "질문" });
    await addMessage({
      conversationId: conversation.id,
      organizationId: orgA.organizationId,
      role: "ASSISTANT",
      content: "답변",
      citations: [
        {
          contractClauseId: null,
          chunkId: "some-chunk-id",
          contractId: orgA.contractId,
          contractTitle: orgA.contractTitle,
          clauseNumber: "본문 발췌 1",
          evidenceText: `기밀 근거: ${CANARY}`,
          score: 0.5,
          sourcePageStart: 1,
          sourcePageEnd: 1,
          chunkStartOffset: 0,
          chunkEndOffset: 10,
        },
      ],
    });

    // Org B, using its OWN owner's userId, must never resolve Org A's conversationId.
    const foundByOrgB = await findConversationById({
      organizationId: orgB.organizationId,
      userId: orgB.ownerId,
      conversationId: conversation.id,
    });
    expect(foundByOrgB).toBeNull();

    const messagesForOrgB = await listMessagesForConversation({
      organizationId: orgB.organizationId,
      userId: orgB.ownerId,
      conversationId: conversation.id,
    });
    expect(messagesForOrgB).toEqual([]);

    // Sanity - Org A itself CAN still read it (the isolation is real scoping, not a universal block).
    const messagesForOrgA = await listMessagesForConversation({
      organizationId: orgA.organizationId,
      userId: orgA.ownerId,
      conversationId: conversation.id,
    });
    expect(messagesForOrgA.length).toBe(2);
    const assistantMessage = messagesForOrgA.find((m) => m.role === "ASSISTANT")!;
    expect(assistantMessage.citations[0]!.chunkId).toBe("some-chunk-id");
    expect(assistantMessage.citations[0]!.evidenceText).toContain(CANARY);
  });
});

describe("§Phase 14.1 Release Gate Audit - exhaustive canary-marker cross-layer leakage check", () => {
  const QUESTION = "이 계약에서 비밀유지와 관련하여 참고할 만한 내용을 모두 알려줘";

  it("Org A's own retrieval DOES find the canary (sanity check the fixture is real) - checked against the full chunk text, not the single extracted evidence sentence (extractEvidenceSentence may legitimately pick a different real sentence from the same chunk for this broad question)", async () => {
    const chunkResults = await hybridSearchDocumentChunks({ organizationId: orgA.organizationId, question: QUESTION, topK: 20 });
    expect(chunkResults.some((r) => r.text.includes(CANARY))).toBe(true);
  });

  it("Org B's request never sees the canary at ANY layer: lexical, vector, fusion, packed context, prompt, citations, or final answer", async () => {
    // Lexical (keyword) leg.
    const keywordMatches = await findChunkKeywordMatchCounts(orgB.organizationId, ["비밀유지", "영업비밀"]);
    const keywordChunkIds = [...keywordMatches.keys()];
    const keywordChunks = await prisma.contractDocumentChunk.findMany({ where: { id: { in: keywordChunkIds } } });
    for (const chunk of keywordChunks) {
      expect(chunk.text).not.toContain(CANARY);
    }

    // Clause leg (structured evidence).
    const clauseResults = await hybridSearchClauses({ organizationId: orgB.organizationId, question: QUESTION, topK: 20 });
    for (const result of clauseResults) {
      expect(result.text).not.toContain(CANARY);
    }

    // Chunk leg (vector + keyword fusion + rerank, already hydrated).
    const chunkResults = await hybridSearchDocumentChunks({ organizationId: orgB.organizationId, question: QUESTION, topK: 20 });
    for (const result of chunkResults) {
      expect(result.text).not.toContain(CANARY);
    }

    // Dual-retrieval fusion (packed context / final citations before token-budget selection).
    const citations = await retrieveContext({ organizationId: orgB.organizationId, question: QUESTION });
    for (const citation of citations) {
      expect(citation.evidenceText).not.toContain(CANARY);
      expect(citation.contractTitle).not.toContain(CANARY);
      expect(citation.contractId).toBe(orgB.contractId);
    }

    // The actual prompt text that would be sent to the LLM - reconstructed
    // from the SAME citations, via the SAME real prompt builder.
    const messages = buildPromptMessages(QUESTION, citations);
    for (const message of messages) {
      expect(message.content).not.toContain(CANARY);
    }

    // Full askQuestion() pipeline - final answer text and citations.
    const result = await askQuestion({ organizationId: orgB.organizationId, question: QUESTION });
    expect(result.answerText).not.toContain(CANARY);
    for (const citation of result.citations) {
      expect(citation.evidenceText).not.toContain(CANARY);
      expect(citation.contractId).toBe(orgB.contractId);
    }

    // Cache - re-running the identical Org B query must still never surface
    // the canary (proves no cache entry got cross-contaminated during this test).
    const repeat = await askQuestion({ organizationId: orgB.organizationId, question: QUESTION });
    expect(repeat.answerText).not.toContain(CANARY);

    // Conversation history - persist Org B's own real answer and confirm
    // the stored record is clean too (defense in depth beyond the
    // in-memory citations check above).
    const conversation = await createConversation({ organizationId: orgB.organizationId, userId: orgB.ownerId });
    await addMessage({
      conversationId: conversation.id,
      organizationId: orgB.organizationId,
      role: "ASSISTANT",
      content: result.answerText,
      citations: result.citations.map((citation) => ({
        contractClauseId: citation.contractClauseId,
        chunkId: citation.evidenceType === "chunk" ? citation.chunkId : null,
        contractId: citation.contractId,
        contractTitle: citation.contractTitle,
        clauseNumber: citation.clauseReference,
        evidenceText: citation.evidenceText,
        score: citation.score,
        sourcePageStart: citation.evidenceType === "chunk" ? citation.sourcePageStart : null,
        sourcePageEnd: citation.evidenceType === "chunk" ? citation.sourcePageEnd : null,
        chunkStartOffset: citation.evidenceType === "chunk" ? citation.chunkStartOffset : null,
        chunkEndOffset: citation.evidenceType === "chunk" ? citation.chunkEndOffset : null,
      })),
    });
    const persisted = await listMessagesForConversation({
      organizationId: orgB.organizationId,
      userId: orgB.ownerId,
      conversationId: conversation.id,
    });
    for (const message of persisted) {
      expect(message.content).not.toContain(CANARY);
      for (const citation of message.citations) {
        expect(citation.evidenceText).not.toContain(CANARY);
      }
    }
  });
});

describe("§Phase 14.1 Release Gate Audit - contract deletion removes raw retrieval candidates", () => {
  /**
   * Checked at the UNCACHED provider/repository layer (searchDocumentChunkVectors,
   * findChunkKeywordMatchCounts, the pgvector/application-cosine queries
   * themselves - all filter `contract.deletedAt IS NULL` directly in SQL,
   * confirmed by reading each), not through hybridSearchDocumentChunks()/
   * hybridSearchClauses() - those cache the WHOLE result for
   * AI_RETRIEVAL_CACHE_TTL_SECONDS (default 300s), keyed by a checksum of
   * the embedding SET (count + latest timestamp), which contract deletion
   * does not change. Calling the cached wrapper immediately before/after
   * a soft-delete in the same test would just observe a same-org cache hit,
   * not the real underlying query behavior - see this describe block's
   * second test for that finding, documented (not treated as a tenant-
   * isolation failure - it's same-organization, bounded by the TTL).
   */
  it("the underlying (uncached) chunk keyword/vector queries exclude a soft-deleted contract's chunks", async () => {
    const beforeKeyword = await findChunkKeywordMatchCounts(orgA.organizationId, ["비밀유지", "영업비밀"]);
    expect(beforeKeyword.size).toBeGreaterThan(0);

    const embeddingProvider = getEmbeddingProvider();
    const queryEmbedding = await embeddingProvider.generateEmbedding("비밀유지 의무");
    const beforeVector = await searchDocumentChunkVectors({
      organizationId: orgA.organizationId,
      queryVector: queryEmbedding.vector,
      embeddingProvider: embeddingProvider.providerName,
      embeddingModel: embeddingProvider.modelName,
      topK: 20,
    });
    expect(beforeVector.some((r) => r.contractId === orgA.contractId)).toBe(true);

    await prisma.contract.update({ where: { id: orgA.contractId }, data: { deletedAt: new Date() } });
    try {
      const afterKeyword = await findChunkKeywordMatchCounts(orgA.organizationId, ["비밀유지", "영업비밀"]);
      expect(afterKeyword.size).toBe(0);

      const afterVector = await searchDocumentChunkVectors({
        organizationId: orgA.organizationId,
        queryVector: queryEmbedding.vector,
        embeddingProvider: embeddingProvider.providerName,
        embeddingModel: embeddingProvider.modelName,
        topK: 20,
      });
      expect(afterVector.every((r) => r.contractId !== orgA.contractId)).toBe(true);
    } finally {
      await prisma.contract.update({ where: { id: orgA.contractId }, data: { deletedAt: null } });
    }
  });

  /**
   * §Phase 14.2 §8/§11 - FIXED. The Phase 14.1 audit found that the
   * retrieval cache's checksum invalidation tracked the embedding SET
   * only, not contract lifecycle, so a cached result computed before a
   * deletion could still be served (same-org, bounded by
   * AI_RETRIEVAL_CACHE_TTL_SECONDS). getLatestChunkEmbeddingGenerationChecksum()/
   * getLatestEmbeddingGenerationChecksum() now scope their aggregate to
   * latestAuthoritativeExtractedDocumentIdsForOrganization()/
   * latestAuthoritativeClauseSegmentationJobIdsForOrganization() (both
   * ai-retrieval-freshness.ts, both re-derive LIVE contracts on every
   * call) - a contract soft-delete immediately changes the eligible-id
   * set, which immediately changes the checksum, which is recomputed
   * fresh on every call (never itself cached) - so a cache "hit" against
   * the OLD checksum can never happen again after a deletion, with no TTL
   * wait required.
   */
  it("soft-deleting a contract immediately invalidates the retrieval cache - no TTL wait required", async () => {
    const before = await hybridSearchDocumentChunks({
      organizationId: orgA.organizationId,
      question: "비밀유지 의무 관련 캐시 조회",
      topK: 20,
    });
    expect(before.some((r) => r.contractId === orgA.contractId)).toBe(true);

    await prisma.contract.update({ where: { id: orgA.contractId }, data: { deletedAt: new Date() } });
    try {
      const after = await hybridSearchDocumentChunks({
        organizationId: orgA.organizationId,
        question: "비밀유지 의무 관련 캐시 조회",
        topK: 20,
      });
      expect(after.some((r) => r.contractId === orgA.contractId)).toBe(false);
    } finally {
      await prisma.contract.update({ where: { id: orgA.contractId }, data: { deletedAt: null } });
    }
  });
});
