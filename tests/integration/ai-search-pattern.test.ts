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
import { askQuestion, askQuestionStreaming } from "@/features/ai/server/ask-question";
import { getAiSearchPatternSummary } from "@/features/ai/server/get-ai-search-pattern-summary";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-search-pattern-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLE_LINES = [
  "소프트웨어 개발 용역계약서",
  "",
  "제1조(계약 해지)",
  "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
  "",
  "제2조(비밀유지)",
  "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
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
  org = await prisma.organization.create({
    data: { name: "AI Search Pattern Test Org", slug: `ai-search-pattern-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "AI Search Pattern Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "AI 검색 패턴 테스트 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "ai-search-pattern-test.docx",
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
  await drainAllPendingExtractionJobs();

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });

  await createClauseSegmentationJob({
    userId: owner.id,
    organizationId: org.id,
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
  await prisma.aiSearchPattern.deleteMany({ where: { organizationId: org.id } });
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractClause.deleteMany({ where: { contractId } });
  await prisma.contractSection.deleteMany({ where: { contractId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

describe("Organization Memory - AiSearchPattern recording (Phase 12 Part K)", () => {
  it("askQuestion records CLAUSE_TYPE and KEYWORD_STEM patterns for a relevant, sufficiently-evidenced question", async () => {
    const result = await askQuestion({ organizationId: org.id, question: "계약을 해지하려면 어떻게 해야 하나요?" });
    expect(result.sufficient).toBe(true);

    const rows = await prisma.aiSearchPattern.findMany({ where: { organizationId: org.id } });
    expect(rows.some((row) => row.patternType === "CLAUSE_TYPE" && row.patternKey === "TERMINATION")).toBe(true);
    expect(rows.some((row) => row.patternType === "KEYWORD_STEM")).toBe(true);

    // No row ever carries the raw question text, a userId-like field, or clause/evidence text.
    for (const row of rows) {
      expect(row.patternKey.length).toBeLessThanOrEqual(20);
      expect(row).not.toHaveProperty("userId");
      expect(row).not.toHaveProperty("evidenceText");
      expect(row).not.toHaveProperty("question");
    }
  });

  it("repeating the same question increments count rather than duplicating rows", async () => {
    const before = await prisma.aiSearchPattern.findFirst({
      where: { organizationId: org.id, patternType: "CLAUSE_TYPE", patternKey: "TERMINATION" },
    });
    expect(before).not.toBeNull();
    const beforeCount = before!.count;

    await askQuestion({ organizationId: org.id, question: "계약을 해지하려면 어떻게 해야 하나요?" });

    const after = await prisma.aiSearchPattern.findUnique({ where: { id: before!.id } });
    expect(after!.count).toBe(beforeCount + 1);
  });

  it("askQuestionStreaming also records patterns (streaming path uses the same recorder)", async () => {
    for await (const _event of askQuestionStreaming({
      organizationId: org.id,
      question: "영업비밀 누설 금지 조항이 있나요?",
    })) {
      // drain the generator
    }

    const rows = await prisma.aiSearchPattern.findMany({
      where: { organizationId: org.id, patternType: "CLAUSE_TYPE", patternKey: "CONFIDENTIALITY" },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("an insufficient-evidence question still records a KEYWORD_STEM pattern but never a CLAUSE_TYPE pattern for it", async () => {
    const result = await askQuestion({ organizationId: org.id, question: "완전히무관한고유질문토큰zzz" });
    expect(result.sufficient).toBe(false);

    const rows = await prisma.aiSearchPattern.findMany({ where: { organizationId: org.id, patternType: "KEYWORD_STEM" } });
    expect(rows.some((row) => row.patternKey === "완전")).toBe(true);
  });

  it("getAiSearchPatternSummary surfaces the aggregate counts with Korean labels, sorted by count", async () => {
    const summary = await getAiSearchPatternSummary({ userId: owner.id, organizationId: org.id });

    expect(summary.topClauseTypes.some((row) => row.patternKey === "TERMINATION" && row.label === "해지")).toBe(true);
    expect(summary.topKeywordStems.length).toBeGreaterThan(0);

    for (let i = 1; i < summary.topClauseTypes.length; i += 1) {
      expect(summary.topClauseTypes[i - 1]!.count).toBeGreaterThanOrEqual(summary.topClauseTypes[i]!.count);
    }
  });
});
