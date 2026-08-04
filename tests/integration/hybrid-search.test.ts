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
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { askQuestion, askQuestionStreaming } from "@/features/ai/server/ask-question";
import { assertCitationsPresent } from "@/domain/ai/citation";
import { UNKNOWN_ANSWER_TEXT } from "@/domain/ai/hallucination-guard";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "hybrid-search-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLE_LINES = [
  "소프트웨어 개발 용역계약서",
  "",
  "제1조(계약 해지)",
  "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
  "",
  "제2조(비밀유지)",
  "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
  "",
  "제3조(대금지급)",
  "발주자는 용역 완료 후 30일 이내에 대금을 지급하여야 한다.",
];

let orgA: { id: string };
let orgB: { id: string };
let owner: { id: string };
let contractId: string;
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

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  orgA = await prisma.organization.create({
    data: { name: "Hybrid Search Test Org A", slug: `hybrid-search-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Hybrid Search Test Org B", slug: `hybrid-search-test-b-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Hybrid Search Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  await prisma.user.create({
    data: {
      name: "Hybrid Search Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: orgA.id,
    input: { title: "하이브리드 검색 테스트 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: orgA.id,
    contractId,
    originalName: "hybrid-search-test.docx",
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: owner.id,
    organizationId: orgA.id,
    contractId,
    input: { contractFileId: uploaded.id },
  });
  await drainAllPendingExtractionJobs();

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });

  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: orgA.id,
    contractId,
    input: { extractedDocumentId: document.id },
  });
  await drainAllPendingSegmentationJobs();
  await drainAllPendingEmbeddingJobs();
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.contractClause.deleteMany({ where: { contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("hybridSearchClauses (Phase 12 Part B)", () => {
  it("ranks the termination clause first for a termination-related question", async () => {
    const results = await hybridSearchClauses({
      organizationId: orgA.id,
      question: "계약을 해지하려면 어떻게 해야 하나요?",
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text).toContain("해지");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("ranks the confidentiality clause first for a confidentiality-related question", async () => {
    const results = await hybridSearchClauses({
      organizationId: orgA.id,
      question: "영업비밀 누설 금지 조항이 있나요?",
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text).toContain("비밀");
  });

  it("every result includes contractTitle/clauseNumber-or-title/text (§Citation prerequisites)", async () => {
    const results = await hybridSearchClauses({ organizationId: orgA.id, question: "대금 지급 기한은?", topK: 3 });
    for (const result of results) {
      expect(result.contractTitle).toBeTruthy();
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.contractClauseId).toBeTruthy();
    }
  });

  it("tenant isolation - a different organization's search never returns orgA's clauses", async () => {
    const results = await hybridSearchClauses({ organizationId: orgB.id, question: "계약 해지", topK: 5 });
    expect(results).toEqual([]);
  });

  it("never throws for an unrelated question - hard evidence-sufficiency thresholding is the hallucination guard's job, not this layer's", async () => {
    const results = await hybridSearchClauses({ organizationId: orgA.id, question: "완전히 무관한 질문 xyz123", topK: 5 });
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("retrieveContext (Phase 12 Part C §Retrieval)", () => {
  it("returns fully-formed Citations that pass assertCitationsPresent (§Citation)", async () => {
    const citations = await retrieveContext({ organizationId: orgA.id, question: "계약 해지 방법", topK: 5 });

    expect(citations.length).toBeGreaterThan(0);
    expect(() => assertCitationsPresent(citations)).not.toThrow();
    for (const citation of citations) {
      expect(citation.contractTitle).toBeTruthy();
      expect(citation.clauseReference).toBeTruthy();
      expect(citation.evidenceText).toBeTruthy();
      expect(citation.evidenceText.length).toBeLessThanOrEqual(500);
    }
  });

  it("returns an empty array for an org with no matching content, never throwing", async () => {
    const citations = await retrieveContext({ organizationId: orgB.id, question: "계약 해지", topK: 5 });
    expect(citations).toEqual([]);
  });
});

describe("askQuestion (Phase 12 Part D/F - full RAG pipeline, real end-to-end)", () => {
  it("answers a relevant question with real citations grounded in the actual clause text", async () => {
    const result = await askQuestion({ organizationId: orgA.id, question: "계약을 해지하려면 어떻게 해야 하나요?" });

    expect(result.sufficient).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answerText).toContain("해지");
    expect(result.answerText).toContain("[출처:");
  });

  it("refuses to guess and returns the fixed UNKNOWN_ANSWER_TEXT for an org with zero relevant content", async () => {
    const result = await askQuestion({ organizationId: orgB.id, question: "계약 해지 방법" });

    expect(result.sufficient).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.answerText).toBe(UNKNOWN_ANSWER_TEXT);
  });

  // Regression test for a real bug an E2E run caught
  // (tests/e2e/ai-conversation-flow.spec.ts): a genuinely unrelated
  // question, asked against an ORG THAT DOES HAVE real embedded clauses,
  // was incorrectly answered instead of triggering the hallucination
  // guard - whole-token keyword matching found zero overlap for either
  // question, so both relied entirely on char-trigram vector noise,
  // which was not well-separated at the threshold then in use. Fixed by
  // switching the keyword leg to stem-based matching (see
  // clause-keyword-match-repository.ts) so a real topical question gets
  // real keyword credit that an unrelated one never does.
  it("refuses to guess for a genuinely unrelated question even when the organization DOES have real embedded clauses", async () => {
    const result = await askQuestion({ organizationId: orgA.id, question: "오늘 서울 날씨는 어떤가요?" });

    expect(result.sufficient).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.answerText).toBe(UNKNOWN_ANSWER_TEXT);
  });

  it("askQuestionStreaming yields citations, then only fully citation-verified paragraph chunks, then done", async () => {
    const events: Array<{ type: string }> = [];
    let sawCitations = false;
    let fullText = "";

    for await (const event of askQuestionStreaming({
      organizationId: orgA.id,
      question: "영업비밀 누설 금지 조항이 있나요?",
    })) {
      events.push(event);
      if (event.type === "citations") {
        sawCitations = true;
        expect(event.citations.length).toBeGreaterThan(0);
      }
      if (event.type === "chunk") {
        expect(event.text).toContain("[출처:"); // every forwarded chunk is already citation-verified
      }
      if (event.type === "done") {
        fullText = event.fullText;
      }
    }

    expect(sawCitations).toBe(true);
    expect(events[events.length - 1]!.type).toBe("done");
    expect(fullText).toContain("비밀");
  });

  it("askQuestionStreaming for an org with no relevant content streams the fixed unknown-answer text, not a guess", async () => {
    const chunks: string[] = [];
    for await (const event of askQuestionStreaming({ organizationId: orgB.id, question: "계약 해지 방법" })) {
      if (event.type === "chunk") chunks.push(event.text);
    }
    expect(chunks.join("")).toBe(UNKNOWN_ANSWER_TEXT);
  });
});
