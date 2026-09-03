import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { MIN_CITATION_SCORE } from "@/domain/ai/hallucination-guard";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { runVectorBackfill } from "@/features/ai/server/run-vector-backfill";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import { createContract } from "@/features/contracts/server/create-contract";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import {
  addMessage,
  createConversation,
  findConversationById,
} from "@/server/repositories/ai-conversation-repository";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

/**
 * §AI 답변 품질 개편 P0-1 - Tests A/B/C from the implementation task,
 * against real retrieval (real clause + real embedding via the
 * development provider, real hybridSearchClauses()) and the real
 * Conversation.contractId scope guarantee, mirroring the established
 * fixture pattern (see clause-vector-search-providers.test.ts).
 */

const TEST_EMAIL_DOMAIN = "ai-conversation-history-context-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Contract A: the audit's exact scenario (자동갱신/통지/30일).
const CONTRACT_A_LINES = [
  "제2조(계약기간)",
  "본 계약은 계약기간 종료 후 자동갱신되며, 종료 30일 전까지 서면으로 통지하지 않으면 동일한 조건으로 갱신된다.",
];
// Contract B: a completely different topic (지식재산권) - used for Test C
// (history from Contract A must never affect a Contract B scoped request).
const CONTRACT_B_LINES = ["제5조(지식재산권)", "본 계약 수행 결과물의 지식재산권은 발주자에게 귀속된다."];

let organizationId: string;
let ownerId: string;
let contractAId: string;
let contractBId: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(processNext: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await processNext(`${label}-${attempt}`)).processed) return;
  }
}

async function seedContract(label: string, title: string, lines: string[]): Promise<string> {
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
    originalName: `${label}.docx`,
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

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: ownerId,
    organizationId,
    contractId: created.id,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${label}-seg`);

  return created.id;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  const org = await prisma.organization.create({
    data: { name: "AI Conversation History Context Test Org", slug: `ai-conv-history-test-${Date.now()}` },
  });
  organizationId = org.id;
  const owner = await prisma.user.create({
    data: {
      name: "Conversation History Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId, role: MembershipRole.OWNER } },
    },
  });
  ownerId = owner.id;

  contractAId = await seedContract("contract-a", "대화 맥락 테스트 - 계약 A (자동갱신)", CONTRACT_A_LINES);
  contractBId = await seedContract("contract-b", "대화 맥락 테스트 - 계약 B (지식재산권)", CONTRACT_B_LINES);

  await drain(processNextEmbeddingJob, "embed");
  await runVectorBackfill({ limit: 10_000 });
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => undefined);
  }
  await prisma.organization.deleteMany({ where: { id: organizationId } });
});

describe("Test A - a contextless follow-up retrieves the right clause once bounded history is folded in", () => {
  const followUp = "그럼 언제까지 말해야 돼?";
  const history = [
    { role: "USER" as const, content: "이 계약 자동갱신돼?" },
    { role: "ASSISTANT" as const, content: "네, 자동 갱신되는 구조입니다. 종료 30일 전까지 통지해야 합니다." },
  ];

  it("WITHOUT history, the bare follow-up does not clear the hallucination-guard threshold for the renewal/notice clause", async () => {
    const results = await hybridSearchClauses({ organizationId, question: followUp, contractId: contractAId });
    const target = results.find((r) => r.text.includes("자동갱신"));
    // Either not found at all, or found but scoring below what the
    // hallucination guard requires - either way, unusable on its own.
    expect(!target || target.score < MIN_CITATION_SCORE).toBe(true);
  });

  it("WITH the bounded prior turn folded in, the follow-up retrieves the renewal/notice clause above the hallucination-guard threshold", async () => {
    const results = await hybridSearchClauses({
      organizationId,
      question: followUp,
      contractId: contractAId,
      history,
    });
    const target = results.find((r) => r.text.includes("자동갱신"));
    expect(target).toBeDefined();
    expect(target!.score).toBeGreaterThanOrEqual(MIN_CITATION_SCORE);
  });
});

describe("Test B - two different histories with an IDENTICAL final question must not share an incorrect cached result", () => {
  const sharedFinalQuestion = "그거 어떻게 되나요?";
  const renewalHistory = [
    { role: "USER" as const, content: "이 계약 자동갱신돼?" },
    { role: "ASSISTANT" as const, content: "네, 자동 갱신되는 구조이며 종료 30일 전까지 통지해야 합니다." },
  ];
  const ipHistory = [
    { role: "USER" as const, content: "결과물 지식재산권은 누구 거야?" },
    { role: "ASSISTANT" as const, content: "발주자에게 귀속됩니다." },
  ];

  it("each history's own concept surfaces as the top result for the identical final question - not because retrieval is smarter, but because the history fingerprint actually participates in the cache key (a caching BUG here would silently serve whichever history's result was computed first, for every subsequent call regardless of its own history)", async () => {
    // Org-wide (no contractId) so BOTH contracts' clauses are genuinely in
    // the candidate pool - a single-clause-per-contract scope cannot
    // distinguish "used the right cache entry" from "there was only one
    // possible answer anyway".
    const withRenewalHistory = await hybridSearchClauses({
      organizationId,
      question: sharedFinalQuestion,
      history: renewalHistory,
    });
    const withIpHistory = await hybridSearchClauses({
      organizationId,
      question: sharedFinalQuestion,
      history: ipHistory,
    });

    expect(withRenewalHistory[0]?.text).toContain("자동갱신");
    expect(withIpHistory[0]?.text).toContain("지식재산권");
  });
});

describe("Test C - history/scope must never escape from one contract to another", () => {
  it("retrieval scoped to Contract B never surfaces Contract A's clause, even when history mentions Contract A's own concepts", async () => {
    const crossContractHistory = [
      { role: "USER" as const, content: "이 계약 자동갱신돼?" },
      { role: "ASSISTANT" as const, content: "네, 자동 갱신되는 구조이며 종료 30일 전까지 통지해야 합니다." },
    ];
    const results = await hybridSearchClauses({
      organizationId,
      question: "그럼 언제까지 말해야 돼?",
      contractId: contractBId, // scoped to B, but history is about A's renewal clause
      history: crossContractHistory,
    });
    // The mandatory contractId filter (pre-existing tenant isolation,
    // untouched by P0-1) must still exclude every Contract A row,
    // regardless of what concepts the history text contains.
    expect(results.every((r) => r.contractId === contractBId)).toBe(true);
    expect(results.some((r) => r.text.includes("자동갱신"))).toBe(false);
  });

  it("a conversation's contractId is set once at creation and is a permanent, queryable fact route.ts's own scope check relies on", async () => {
    const conversation = await createConversation({ organizationId, userId: ownerId, contractId: contractAId });
    await addMessage({ conversationId: conversation.id, organizationId, role: "USER", content: "이 계약 자동갱신돼?" });

    const reloaded = await findConversationById({ organizationId, userId: ownerId, conversationId: conversation.id });
    expect(reloaded).not.toBeNull();
    expect(reloaded!.contractId).toBe(contractAId);
    // This is exactly the condition src/app/api/ai/ask/route.ts evaluates
    // on every follow-up request - reusing this SAME conversationId with
    // Contract B's id must be rejected (found.contractId !== contractId).
    expect(reloaded!.contractId).not.toBe(contractBId);
  });

  it("an org-wide conversation (no contractId) is distinguishable from any contract-scoped one - null, never an empty string or a wrong default", async () => {
    const orgWideConversation = await createConversation({ organizationId, userId: ownerId });
    const reloaded = await findConversationById({
      organizationId,
      userId: ownerId,
      conversationId: orgWideConversation.id,
    });
    expect(reloaded!.contractId).toBeNull();
  });
});
