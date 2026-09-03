import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { classifyQuestionComplexity } from "@/domain/ai/question-complexity";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { processNextChunkEmbeddingJob } from "@/features/ai/server/process-document-chunk-embedding-job";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { retrieveContext } from "@/features/ai/server/retrieve-context";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "ai-family-sampling-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * §AI 답변 품질 개편 Phase 1.2 P0-3 - the exact q15 phrasing from the
 * task's own 30-question evaluation set. Deliberately vague, and - unlike
 * tests/integration/ai-comprehensive-review-coverage.test.ts's own
 * COMPREHENSIVE_QUESTION ("...불리하거나 위험할 수 있는 조항을 모두
 * 검토해줘", which shares real vocabulary with that file's own
 * "위험"-worded markers) - this question shares ZERO vocabulary with any
 * marker below. That is the whole point of this file: it isolates the
 * NEW family-sampling path from the pre-existing wide-topK semantic path,
 * proving broad coverage no longer depends on the question happening to
 * echo the clause's own wording.
 */
const Q15_QUESTION = "내가 불리한 게 뭐야?";

/**
 * One neutral marker sentence per auto-classifiable high-value family
 * (see deterministic-korean-clause-classifier.ts's own CLASSIFICATION_RULES
 * - only these types are ever assigned suggestedClauseType without a human
 * review step). Deliberately plain, procedural wording - no "위험"/"불리"/
 * "검토"/"주의" vocabulary anywhere - so any coverage measured against
 * Q15_QUESTION below can only come from structural family sampling, never
 * from lucky keyword or vector overlap with the question text.
 */
const FAMILY_MARKERS = {
  TERMINATION: "일방은 상대방에게 30일 전 서면으로 통지한 후 본 계약을 해지할 수 있다",
  PAYMENT: "대금은 매월 25일에 을이 지정하는 계좌로 지급한다",
  CONFIDENTIALITY: "본 계약과 관련하여 취득한 기밀 정보는 제3자에게 공개하지 아니한다",
  LIABILITY: "고의 또는 과실로 상대방에게 손해배상 책임이 발생한 경우 이를 배상한다",
  AUTO_RENEWAL: "별도의 의사표시가 없는 한 자동갱신되어 1년간 연장된다",
  ASSIGNMENT: "사전 서면 동의 없이 본 계약상 권리를 제3자에게 양도할 수 없다",
  GOVERNING_LAW: "본 계약은 대한민국 법률을 준거법으로 하여 규율된다",
  JURISDICTION: "본 계약에 관한 소는 서울중앙지방법원을 관할 법원으로 한다",
};

const CONTRACT_A_LINES = [
  "가족표본추출 테스트 계약서 A",
  "",
  "제1조(목적)",
  "본 계약은 갑과 을 간의 거래에 관한 제반 사항을 정함을 목적으로 한다.",
  "",
  "제2조(정의)",
  "본 계약에서 사용하는 용어의 정의는 다음 각 호와 같다.",
  "",
  "제3조(해지)",
  `${FAMILY_MARKERS.TERMINATION}.`,
  "",
  "제4조(통지방법)",
  "본 계약과 관련한 통지는 서면으로 하여야 하며 상대방의 등록된 주소지로 발송한다.",
  "",
  "제5조(대금지급)",
  `${FAMILY_MARKERS.PAYMENT}.`,
  "",
  "제6조(불가항력)",
  "천재지변 등 불가항력 사유로 인한 계약 불이행에 대하여는 책임을 지지 아니한다.",
  "",
  "제7조(비밀유지)",
  `${FAMILY_MARKERS.CONFIDENTIALITY}.`,
  "",
  "제8조(완전합의)",
  "본 계약은 당사자 간의 완전한 합의를 구성하며 이전의 모든 합의를 대체한다.",
  "",
  "제9조(손해배상)",
  `${FAMILY_MARKERS.LIABILITY}.`,
  "",
  "제10조(가분성)",
  "본 계약의 일부 조항이 무효로 되더라도 나머지 조항의 효력에는 영향을 미치지 아니한다.",
  "",
  "제11조(자동갱신)",
  `${FAMILY_MARKERS.AUTO_RENEWAL}.`,
  "",
  "제12조(언어)",
  "본 계약서는 국문으로 작성되며 국문본을 원본으로 한다.",
  "",
  "제13조(양도)",
  `${FAMILY_MARKERS.ASSIGNMENT}.`,
  "",
  "제14조(부칙)",
  "본 계약에 정하지 아니한 사항은 관계 법령 및 상관례에 따른다.",
  "",
  "제15조(준거법)",
  `${FAMILY_MARKERS.GOVERNING_LAW}.`,
  "",
  "제16조(정산)",
  "계약 종료 시 미정산 금액은 종료일로부터 30일 이내에 정산한다.",
  "",
  "제17조(관할)",
  `${FAMILY_MARKERS.JURISDICTION}.`,
  "",
  "제18조(부본)",
  "본 계약서는 2부를 작성하여 갑과 을이 각 1부씩 보관한다.",
  "",
  "제19조(발효)",
  "본 계약은 양 당사자가 서명한 날로부터 효력이 발생한다.",
  "",
  "제20조(서명)",
  "본 계약을 증명하기 위하여 계약서 2부를 작성하여 각자 서명 날인 후 각 1부씩 보관한다.",
  "",
  "제21조(당사자 표시)",
  "본 계약의 당사자는 전항에 기재된 갑과 을로 한다.",
  "",
  "제22조(위임)",
  "당사자는 본 계약상 업무의 일부를 소속 임직원에게 위임하여 처리하게 할 수 있다.",
  "",
  "제23조(문서 보관)",
  "당사자는 본 계약과 관련된 문서를 계약 종료 후 5년간 보관한다.",
  "",
  "제24조(연락 담당자)",
  "각 당사자는 본 계약의 이행을 위한 연락 담당자를 지정하여 상대방에게 통지한다.",
  "",
  "제25조(회의)",
  "당사자는 필요한 경우 정기적으로 협의회를 개최하여 이행 상황을 점검할 수 있다.",
  "",
  "제26조(보고)",
  "을은 갑의 요청이 있는 경우 업무 수행 현황을 서면으로 보고한다.",
  "",
  "제27조(장비)",
  "본 계약 수행에 필요한 장비는 별도 합의가 없는 한 각 당사자가 자체 부담한다.",
  "",
  "제28조(인력)",
  "을은 본 계약 수행에 적합한 자격을 갖춘 인력을 배치한다.",
  "",
  "제29조(장소)",
  "본 계약에 따른 업무는 별도 지정이 없는 한 을의 사업장에서 수행한다.",
  "",
  "제30조(품질 기준)",
  "을이 제공하는 결과물은 업계 통상의 품질 기준을 충족하여야 한다.",
  "",
  "제31조(교육)",
  "갑은 필요한 경우 을의 인력에게 업무 수행에 필요한 교육을 제공할 수 있다.",
  "",
  "제32조(안전)",
  "당사자는 본 계약 수행 과정에서 관계 법령이 정하는 안전 기준을 준수한다.",
  "",
  "제33조(환경)",
  "당사자는 본 계약 수행 과정에서 관계 법령이 정하는 환경 기준을 준수한다.",
  "",
  "제34조(자료 제공)",
  "갑은 을의 업무 수행에 필요한 자료를 적시에 제공한다.",
  "",
  "제35조(협조 의무)",
  "당사자는 본 계약의 원활한 이행을 위하여 상호 성실히 협조한다.",
];

/** A second, org-mate contract with its own DISTINCT clause text per family - proves contract-scoping (§c), never mere org-scoping. */
const CONTRACT_B_JURISDICTION_MARKER = "본 계약에 관한 소는 부산지방법원을 관할 법원으로 한다";
const CONTRACT_B_LINES = [
  "가족표본추출 테스트 계약서 B",
  "",
  "제1조(목적)",
  "본 계약은 갑과 을 간의 별도 거래에 관한 제반 사항을 정함을 목적으로 한다.",
  "",
  "제2조(관할)",
  `${CONTRACT_B_JURISDICTION_MARKER}.`,
];

/** Measured minimum: at least this many of the 8 planted families must be structurally sampled - not 8/8, since deduplication/topK/ordering leave some legitimate slack, but a real regression (family sampling silently broken) would fail this far short. */
const MIN_FAMILIES_COVERED = 5;

interface ContractFixture {
  contractId: string;
}

let organizationId: string;
let ownerId: string;
let contractA: ContractFixture;
let contractB: ContractFixture;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drain(fn: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!(await fn(`family-sampling-drain-${label}-${attempt}`)).processed) return;
  }
}

async function seedContract(label: string, title: string, lines: string[]): Promise<ContractFixture> {
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
    originalName: `family-sampling-${label}.docx`,
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
  await drain(processNextChunkEmbeddingJob, `${label}-chunk-embed`);

  const document = await prisma.contractExtractedDocument.findFirstOrThrow({
    where: { extractionJobId: extractionJob.jobId },
  });
  await createClauseSegmentationJob({
    userId: ownerId,
    organizationId,
    contractId: created.id,
    input: { extractedDocumentId: document.id },
  });
  await drain(processNextClauseSegmentationJob, `${label}-segment`);
  await drain(processNextEmbeddingJob, `${label}-embed`);

  return { contractId: created.id };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  const organization = await prisma.organization.create({
    data: { name: "Family Sampling Test Org", slug: `ai-family-sampling-test-${Date.now()}` },
  });
  organizationId = organization.id;
  const owner = await prisma.user.create({
    data: {
      name: "Family Sampling Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId, role: MembershipRole.OWNER } },
    },
  });
  ownerId = owner.id;

  contractA = await seedContract("a", "가족표본추출 테스트 계약서 A", CONTRACT_A_LINES);
  contractB = await seedContract("b", "가족표본추출 테스트 계약서 B", CONTRACT_B_LINES);
}, 90_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunkEmbedding.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunkEmbeddingJob.deleteMany({ where: { organizationId } });
  await prisma.contractDocumentChunk.deleteMany({ where: { organizationId } });
  await prisma.contractClause.deleteMany({ where: { organizationId } });
  await prisma.contractSection.deleteMany({ where: { organizationId } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId } });
  await prisma.contract.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

function familiesCoveredBy(evidenceTexts: readonly string[]): string[] {
  return Object.entries(FAMILY_MARKERS)
    .filter(([, marker]) => evidenceTexts.some((text) => text.includes(marker)))
    .map(([family]) => family);
}

describe("§AI 답변 품질 개편 Phase 1.2 P0-3 - comprehensive-review family sampling (q15 fix)", () => {
  it("sanity check - q15's exact wording is classified comprehensive", () => {
    expect(classifyQuestionComplexity(Q15_QUESTION)).toBe("comprehensive");
  });

  it("(a) q15's vague phrasing, which shares zero vocabulary with any planted clause, still surfaces a majority of the high-value families via structural sampling (not flat UNKNOWN)", async () => {
    const citations = await retrieveContext({ organizationId, contractId: contractA.contractId, question: Q15_QUESTION });
    expect(citations.length).toBeGreaterThan(0);

    const covered = familiesCoveredBy(citations.map((c) => c.evidenceText));
    console.log(`[family-sampling] q15 covered ${covered.length}/${Object.keys(FAMILY_MARKERS).length}: ${covered.join(", ")}`);
    expect(covered.length).toBeGreaterThanOrEqual(MIN_FAMILIES_COVERED);
  });

  it("(b) a FOCUSED question does NOT invoke the broad-review family-sampling path - an unrelated family's marker (JURISDICTION) is absent even though it would be present for the comprehensive q15 question", async () => {
    const focusedCitations = await retrieveContext({
      organizationId,
      contractId: contractA.contractId,
      question: "대금은 언제 지급돼?",
    });
    expect(classifyQuestionComplexity("대금은 언제 지급돼?")).toBe("focused");

    const focusedTexts = focusedCitations.map((c) => c.evidenceText);
    expect(focusedTexts.some((text) => text.includes(FAMILY_MARKERS.JURISDICTION))).toBe(false);
    expect(focusedTexts.some((text) => text.includes(FAMILY_MARKERS.PAYMENT))).toBe(true);

    const comprehensiveCitations = await retrieveContext({
      organizationId,
      contractId: contractA.contractId,
      question: Q15_QUESTION,
    });
    const comprehensiveTexts = comprehensiveCitations.map((c) => c.evidenceText);
    expect(comprehensiveTexts.some((text) => text.includes(FAMILY_MARKERS.JURISDICTION))).toBe(true);
  });

  it("(c) broad-review family sampling remains contract-scoped - a contractId-scoped q15 on contract A never surfaces contract B's clauses", async () => {
    const citationsForA = await retrieveContext({ organizationId, contractId: contractA.contractId, question: Q15_QUESTION });
    for (const citation of citationsForA) {
      expect(citation.contractId).toBe(contractA.contractId);
    }
    expect(citationsForA.some((c) => c.evidenceText.includes(CONTRACT_B_JURISDICTION_MARKER))).toBe(false);

    const citationsForB = await retrieveContext({ organizationId, contractId: contractB.contractId, question: Q15_QUESTION });
    for (const citation of citationsForB) {
      expect(citation.contractId).toBe(contractB.contractId);
    }
    expect(citationsForB.some((c) => c.evidenceText.includes(CONTRACT_B_JURISDICTION_MARKER))).toBe(true);
  });
});
