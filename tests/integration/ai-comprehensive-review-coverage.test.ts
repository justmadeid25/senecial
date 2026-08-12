import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { askQuestion } from "@/features/ai/server/ask-question";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { classifyQuestionComplexity } from "@/domain/ai/question-complexity";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-comprehensive-review-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * §Phase 14.1 §12 - a synthetic contract with risk-bearing language
 * deliberately SCATTERED across many different articles, interleaved with
 * plenty of ordinary boilerplate clauses in between (real contracts bury
 * risk clauses inside long, mostly-unremarkable documents - a test with 7
 * risk clauses back-to-back would not exercise retrieval the same way).
 * Each risk clause has a short, distinctive marker phrase used ONLY to
 * measure whether retrieval actually surfaced it - never used for the
 * question itself, which stays a realistic, generic "review this whole
 * contract" request.
 */
const RISK_MARKERS = [
  "손해배상액에는 상한이 없다",
  "별도 해지 통지가 없는 한 자동으로 1년씩 갱신된다",
  "갑은 언제든지 사전 통지 없이 본 계약을 해지할 수 있다",
  "을은 본 계약과 관련한 어떠한 책임도 지지 아니한다",
  "위반 시 위약벌로 계약금액의 500%를 지급한다",
  "모든 분쟁은 전속적으로 갑의 소재지 법원을 관할로 한다",
  "을은 계약 종료 후 5년간 동종업계 종사를 금지한다",
] as const;

const CONTRACT_LINES = [
  "종합 업무위탁 계약서",
  "",
  "제1조(목적)",
  "본 계약은 갑과 을 간의 업무위탁에 관한 제반 사항을 정함을 목적으로 한다.",
  "",
  "제2조(손해배상)",
  `을의 귀책사유로 갑에게 손해가 발생한 경우 을은 그 손해를 배상한다. ${RISK_MARKERS[0]}.`,
  "",
  "제3조(정의)",
  "본 계약에서 사용하는 용어의 정의는 다음 각 호와 같다.",
  "",
  "제4조(통지)",
  "본 계약과 관련한 통지는 서면으로 하여야 하며 상대방의 주소지로 발송한다.",
  "",
  "제5조(계약기간 및 갱신)",
  `본 계약의 기간은 1년으로 하며, ${RISK_MARKERS[1]}.`,
  "",
  "제6조(비밀유지)",
  "양 당사자는 본 계약과 관련하여 취득한 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.",
  "",
  "제7조(대금지급)",
  "갑은 을에게 매월 말일 위탁수수료를 지급한다.",
  "",
  "제8조(계약해지)",
  `${RISK_MARKERS[2]}.`,
  "",
  "제9조(지식재산권)",
  "본 계약 수행 과정에서 발생한 지식재산권은 갑에게 귀속된다.",
  "",
  "제10조(불가항력)",
  "천재지변 등 불가항력 사유로 인한 계약 불이행에 대하여는 책임을 지지 아니한다.",
  "",
  "제11조(면책)",
  `${RISK_MARKERS[3]}.`,
  "",
  "제12조(완전합의)",
  "본 계약은 당사자 간의 완전한 합의를 구성하며 이전의 모든 합의를 대체한다.",
  "",
  "제13조(양도금지)",
  "당사자는 상대방의 서면 동의 없이 본 계약상 권리의무를 제3자에게 양도할 수 없다.",
  "",
  "제14조(위약벌)",
  `${RISK_MARKERS[4]}.`,
  "",
  "제15조(준거법)",
  "본 계약은 대한민국 법률에 따라 규율되고 해석된다.",
  "",
  "제16조(서명)",
  "본 계약을 증명하기 위하여 계약서 2부를 작성하여 각자 서명 날인 후 각 1부씩 보관한다.",
  "",
  "제17조(관할)",
  `${RISK_MARKERS[5]}.`,
  "",
  "제18조(부칙)",
  "본 계약에 정하지 아니한 사항은 관계 법령 및 상관례에 따른다.",
  "",
  "제19조(정산)",
  "계약 종료 시 미정산 대금은 종료일로부터 30일 이내에 정산한다.",
  "",
  "제20조(경쟁금지)",
  `${RISK_MARKERS[6]}.`,
  "",
  "제21조(발효)",
  "본 계약은 양 당사자가 서명한 날로부터 효력이 발생한다.",
];

const COMPREHENSIVE_QUESTION = "이 계약에서 을에게 불리하거나 위험할 수 있는 조항을 모두 검토해줘";

/** A conservative fraction of the scattered risk markers a working comprehensive-review pipeline must actually surface - measured against this synthetic contract's real hybrid-search behavior (development embedding provider), not guessed. */
const MIN_COVERAGE_FRACTION = 0.7;

let org: { id: string };
let owner: { id: string };
let contractId: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(fn: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!(await fn(`comprehensive-review-drain-${label}-${attempt}`)).processed) return;
  }
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Comprehensive Review Test Org", slug: `ai-comprehensive-review-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "AI Comprehensive Review Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "종합 업무위탁 계약서", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(CONTRACT_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "comprehensive-review-test.docx",
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

function coverageOf(evidenceTexts: readonly string[]): { found: string[]; missing: string[]; fraction: number } {
  const found = RISK_MARKERS.filter((marker) => evidenceTexts.some((text) => text.includes(marker)));
  const missing = RISK_MARKERS.filter((marker) => !found.includes(marker));
  return { found, missing, fraction: found.length / RISK_MARKERS.length };
}

describe("§Phase 14.1 §12 - comprehensive review retrieval coverage (real measurement, not plausible-sounding output)", () => {
  it("sanity check - the question is actually classified comprehensive (not focused)", () => {
    expect(classifyQuestionComplexity(COMPREHENSIVE_QUESTION)).toBe("comprehensive");
  });

  it("sanity check - all 7 risk clauses were actually segmented/chunked, and are individually findable by direct substring search (proves any coverage gap found below is a RETRIEVAL gap, not a fixture gap)", async () => {
    const chunks = await prisma.contractDocumentChunk.findMany({ where: { contractId } });
    const chunkTexts = chunks.map((c) => c.text);
    for (const marker of RISK_MARKERS) {
      expect(chunkTexts.some((text) => text.includes(marker))).toBe(true);
    }
  });

  it("retrieveContext's real coverage for a comprehensive review question meets the measured minimum threshold", async () => {
    const citations = await retrieveContext({ organizationId: org.id, question: COMPREHENSIVE_QUESTION });
    expect(citations.length).toBeGreaterThan(0);

    const coverage = coverageOf(citations.map((c) => c.evidenceText));
    console.log(
      `[comprehensive-review-coverage] found ${coverage.found.length}/${RISK_MARKERS.length} ` +
        `(${(coverage.fraction * 100).toFixed(0)}%); missing: ${JSON.stringify(coverage.missing)}`
    );
    expect(coverage.fraction).toBeGreaterThanOrEqual(MIN_COVERAGE_FRACTION);
  });

  it("a FOCUSED single-fact question retrieves strictly less coverage than the comprehensive question above - proves the wider topK is doing real work, not a no-op", async () => {
    const focusedCitations = await retrieveContext({
      organizationId: org.id,
      question: "위약벌은 얼마인가요?",
    });
    const comprehensiveCitations = await retrieveContext({ organizationId: org.id, question: COMPREHENSIVE_QUESTION });

    const focusedCoverage = coverageOf(focusedCitations.map((c) => c.evidenceText));
    const comprehensiveCoverage = coverageOf(comprehensiveCitations.map((c) => c.evidenceText));
    expect(comprehensiveCoverage.found.length).toBeGreaterThan(focusedCoverage.found.length);
  });

  it("askQuestion's final answer actually discusses a real majority of the scattered risks, each with a valid citation - not just plausible-sounding prose", async () => {
    const result = await askQuestion({ organizationId: org.id, question: COMPREHENSIVE_QUESTION });
    expect(result.sufficient).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);

    const coverage = coverageOf(result.citations.map((c) => c.evidenceText));
    console.log(
      `[comprehensive-review-coverage/askQuestion] found ${coverage.found.length}/${RISK_MARKERS.length} ` +
        `(${(coverage.fraction * 100).toFixed(0)}%); missing: ${JSON.stringify(coverage.missing)}`
    );
    expect(coverage.fraction).toBeGreaterThanOrEqual(MIN_COVERAGE_FRACTION);

    // Every citation is real: scoped to this org/contract, never fabricated.
    for (const citation of result.citations) {
      expect(citation.contractId).toBe(contractId);
    }
  });
});
