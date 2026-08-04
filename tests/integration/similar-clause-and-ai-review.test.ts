import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { NotFoundError } from "@/lib/errors";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { findSimilarClauses } from "@/features/ai/server/find-similar-clauses";
import { generateAiClauseReview } from "@/features/ai/server/generate-ai-clause-review";
import { createClauseReviewSignals } from "@/server/repositories/clause-review-signal-repository";
import { createClauseStandard } from "@/server/repositories/clause-standard-repository";
import { getStorageDriver } from "@/server/storage";
import { computeChecksum } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "similar-clause-ai-review-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const CONTRACT_A1_LINES = [
  "소프트웨어 개발 용역계약서 A1",
  "",
  "제1조(계약 해지)",
  "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다.",
  "",
  "제2조(비밀유지)",
  "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
];

const CONTRACT_A2_LINES = [
  "소프트웨어 개발 용역계약서 A2",
  "",
  "제1조(해지)",
  "일방 당사자가 계약을 위반하는 경우 타방 당사자는 서면으로 통지하여 계약을 해지할 수 있다.",
];

const CONTRACT_B1_LINES = [
  "오피스 임대차 계약서 B1",
  "",
  "제1조(임대료)",
  "임차인은 매월 말일까지 임대료를 임대인에게 지급하여야 한다.",
];

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };
let contractA1Id: string;
let contractA2Id: string;
let contractB1Id: string;
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

async function setUpContract(params: {
  organizationId: string;
  userId: string;
  title: string;
  lines: string[];
}): Promise<string> {
  const created = await createContract({
    userId: params.userId,
    organizationId: params.organizationId,
    input: { title: params.title, contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });

  const buffer = await buildDocxBuffer(params.lines);
  const uploaded = await uploadContractFile({
    userId: params.userId,
    organizationId: params.organizationId,
    contractId: created.id,
    originalName: `${params.title}.docx`,
    mimeType: DOCX_MIME,
    buffer,
  });
  const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  createdFileStorageKeys.push(fileRow.storageKey);

  const extractionJob = await createExtractionJob({
    userId: params.userId,
    organizationId: params.organizationId,
    contractId: created.id,
    input: { contractFileId: uploaded.id },
  });
  await drainAllPendingExtractionJobs();

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });

  await createClauseSegmentationJob({
    userId: params.userId,
    organizationId: params.organizationId,
    contractId: created.id,
    input: { extractedDocumentId: document.id },
  });
  await drainAllPendingSegmentationJobs();

  return created.id;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  orgA = await prisma.organization.create({
    data: { name: "Similar Clause Test Org A", slug: `similar-clause-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Similar Clause Test Org B", slug: `similar-clause-test-b-${Date.now()}` },
  });
  ownerA = await prisma.user.create({
    data: {
      name: "Similar Clause Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  ownerB = await prisma.user.create({
    data: {
      name: "Similar Clause Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });

  contractA1Id = await setUpContract({
    organizationId: orgA.id,
    userId: ownerA.id,
    title: "유사조항 테스트 계약서 A1",
    lines: CONTRACT_A1_LINES,
  });
  contractA2Id = await setUpContract({
    organizationId: orgA.id,
    userId: ownerA.id,
    title: "유사조항 테스트 계약서 A2",
    lines: CONTRACT_A2_LINES,
  });
  contractB1Id = await setUpContract({
    organizationId: orgB.id,
    userId: ownerB.id,
    title: "유사조항 테스트 계약서 B1",
    lines: CONTRACT_B1_LINES,
  });

  await drainAllPendingEmbeddingJobs();

  await createClauseStandard({
    organizationId: orgA.id,
    name: "표준 해지 조항",
    clauseType: "TERMINATION",
    text: "당사자 일방은 상대방이 계약을 위반한 경우 30일 전 서면 통지 후 계약을 해지할 수 있다.",
    normalizedText: normalizeClauseText(
      "당사자 일방은 상대방이 계약을 위반한 경우 30일 전 서면 통지 후 계약을 해지할 수 있다."
    ),
    isActive: true,
    createdById: ownerA.id,
  });
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  const allContractIds = [contractA1Id, contractA2Id, contractB1Id];
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.clauseStandard.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractClause.deleteMany({ where: { contractId: { in: allContractIds } } });
  await prisma.contractSection.deleteMany({ where: { contractId: { in: allContractIds } } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: { in: allContractIds } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { contractId: { in: allContractIds } } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: allContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: allContractIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

async function findClauseByText(contractId: string, textContains: string) {
  return prisma.contractClause.findFirstOrThrow({ where: { contractId, text: { contains: textContains } } });
}

describe("findSimilarClauses (Phase 12 Part I)", () => {
  it("ranks contractA2's paraphrased termination clause as similar to contractA1's, excluding the clause itself", async () => {
    const a1Termination = await findClauseByText(contractA1Id, "해지");

    const results = await findSimilarClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA1Id,
      clauseId: a1Termination.id,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.contractClauseId !== a1Termination.id)).toBe(true);
    expect(results[0]!.contractId).toBe(contractA2Id);
    expect(results[0]!.similarityScore).toBeGreaterThan(0);
    expect(results[0]!.comparison.lineDiff.length).toBeGreaterThan(0);
  });

  it("never returns a clause from a different organization (tenant isolation)", async () => {
    const a1Termination = await findClauseByText(contractA1Id, "해지");

    const results = await findSimilarClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA1Id,
      clauseId: a1Termination.id,
    });

    expect(results.every((r) => r.contractId !== contractB1Id)).toBe(true);
  });

  it("throws NotFoundError for a clauseId that does not belong to the given contract", async () => {
    const a1Termination = await findClauseByText(contractA1Id, "해지");

    await expect(
      findSimilarClauses({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contractA2Id, // wrong contract for this clause
        clauseId: a1Termination.id,
      })
    ).rejects.toThrow(NotFoundError);
  });
});

describe("generateAiClauseReview (Phase 12 Part J)", () => {
  it("produces a cited, non-judgmental narrative linked to the existing rule-based ClauseReviewSignal", async () => {
    const a1Termination = await findClauseByText(contractA1Id, "해지");

    const signalKey = computeChecksum(Buffer.from(`manual-test-signal:${a1Termination.id}`, "utf8"));
    await createClauseReviewSignals([
      {
        organizationId: orgA.id,
        contractId: contractA1Id,
        contractClauseId: a1Termination.id,
        signalType: "DIFFERENT_FROM_STANDARD",
        title: "기준 조항과 차이가 있습니다",
        description: "테스트용으로 생성된 검토 신호입니다.",
        ruleVersion: "test-v1",
        signalKey,
      },
    ]);

    const review = await generateAiClauseReview({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA1Id,
      clauseId: a1Termination.id,
    });

    expect(review.narrative).toContain("[출처:");
    expect(review.citations.length).toBeGreaterThanOrEqual(2); // self + standard, at minimum
    expect(review.standardName).toBe("표준 해지 조항");
    expect(review.standardComparison).not.toBeNull();
    expect(review.similarClauses.length).toBeGreaterThan(0);
    expect(review.linkedSignal).not.toBeNull();
    expect(review.linkedSignal!.signalKey).toBe(signalKey);

    for (const bannedTerm of ["위험한", "안전합니다", "불법", "무효"]) {
      expect(review.narrative).not.toContain(bannedTerm);
    }
  });

  it("still returns a review (self-citation only) when there is no matching standard", async () => {
    const confidentiality = await findClauseByText(contractA1Id, "영업비밀");

    const review = await generateAiClauseReview({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractA1Id,
      clauseId: confidentiality.id,
    });

    expect(review.narrative).toContain("[출처:");
    expect(review.standardName).toBeNull();
    expect(review.standardComparison).toBeNull();
    expect(review.citations.length).toBeGreaterThanOrEqual(1);
  });
});
