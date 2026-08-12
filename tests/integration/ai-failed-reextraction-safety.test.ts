import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * §Phase 14.2 §7 - Failed Re-extraction Safety. Mocked BEFORE any other
 * import for the same reason as
 * tests/integration/extraction-invalid-provider-response.test.ts: this is
 * the only deterministic way to make a SPECIFIC extraction attempt fail
 * (the real DeterministicDevelopmentContractExtractor always produces
 * schema-valid field output). A call counter lets the FIRST extraction
 * (V1) succeed via the REAL service, then fails the SECOND (V2)
 * deterministically - `contractFieldExtractionResultSchema` rejects
 * confidence=5 (outside [0,1]), which fails BEFORE
 * process-extraction-job.ts's document-creation transaction ever runs
 * (verified by reading that file) - so a failed V2 provably never creates
 * a new ContractExtractedDocument, meaning V1 remains "latest" with no
 * special-case fallback logic needed anywhere in the retrieval path.
 */
let fieldExtractionCallCount = 0;
vi.mock("@/server/services/extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/extraction")>();
  return {
    ...actual,
    getContractFieldExtractionService: () => ({
      extract: async (params: Parameters<ReturnType<typeof actual.getContractFieldExtractionService>["extract"]>[0]) => {
        fieldExtractionCallCount += 1;
        if (fieldExtractionCallCount === 2) {
          return { fields: [{ fieldKey: "title", normalizedValue: { value: "x" }, confidence: 5 }], warnings: [] };
        }
        return actual.getContractFieldExtractionService().extract(params);
      },
    }),
  };
});

const { MembershipRole, ExtractionJobStatus } = await import("@/generated/prisma/enums");
const { createContract } = await import("@/features/contracts/server/create-contract");
const { createClauseSegmentationJob } = await import("@/features/clauses/server/create-clause-segmentation-job");
const { createExtractionJob } = await import("@/features/extraction/server/create-extraction-job");
const { processNextExtractionJob } = await import("@/features/extraction/server/process-extraction-job");
const { processNextClauseSegmentationJob } = await import("@/features/clauses/server/process-clause-segmentation-job");
const { processNextEmbeddingJob } = await import("@/features/ai/server/process-embedding-job");
const { processNextChunkEmbeddingJob } = await import("@/features/ai/server/process-document-chunk-embedding-job");
const { hybridSearchClauses } = await import("@/features/ai/server/hybrid-search-clauses");
const { hybridSearchDocumentChunks } = await import("@/features/ai/server/hybrid-search-document-chunks");
const { askQuestion } = await import("@/features/ai/server/ask-question");
const { uploadContractFile } = await import("@/features/contract-files/server/upload-contract-file");
const { getStorageDriver } = await import("@/server/storage");
const { prisma } = await import("@/server/db/client");

const TEST_EMAIL_DOMAIN = "ai-failed-reextraction-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const V1_MARKER = "계약 종료일은 2027년 12월 31일이다";
const QUESTION = "이 계약은 언제 끝나?";

let org: { id: string };
let owner: { id: string };
let contractId: string;
const createdFileStorageKeys: string[] = [];

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
async function drain(fn: (id: string) => Promise<{ processed: boolean }>, label: string) {
  for (let i = 0; i < 60; i++) if (!(await fn(`failed-reextraction-${label}-${i}`)).processed) return;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "AI Failed Re-extraction Test Org", slug: `ai-failed-reextraction-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Failed Re-extraction Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });
  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "실패한 재추출 안전성 테스트", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;
}, 30_000);

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

describe("§Phase 14.2 §7 - failed re-extraction never invalidates the last-good revision", () => {
  it("V1 processes successfully end-to-end (real pipeline, real fact)", async () => {
    const buffer = await buildDocxBuffer(["제1조(계약기간)", `${V1_MARKER}.`]);
    const uploaded = await uploadContractFile({
      userId: owner.id, organizationId: org.id, contractId,
      originalName: "v1.docx", mimeType: DOCX_MIME, buffer,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const extractionJob = await createExtractionJob({ userId: owner.id, organizationId: org.id, contractId, input: { contractFileId: uploaded.id } });
    await drain(processNextExtractionJob, "v1-extract");
    const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: extractionJob.jobId } });
    expect(job.status).not.toBe(ExtractionJobStatus.FAILED);

    const document = await prisma.contractExtractedDocument.findFirstOrThrow({ where: { extractionJobId: extractionJob.jobId } });
    await createClauseSegmentationJob({ userId: owner.id, organizationId: org.id, contractId, input: { extractedDocumentId: document.id } });
    await drain(processNextClauseSegmentationJob, "v1-segment");
    await drain(processNextEmbeddingJob, "v1-embed");
    await drain(processNextChunkEmbeddingJob, "v1-chunk-embed");

    const results = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(results.some((r) => r.text.includes(V1_MARKER))).toBe(true);
  });

  it("V2's extraction FAILS (INVALID_PROVIDER_RESPONSE) and creates no new ContractExtractedDocument", async () => {
    const buffer = await buildDocxBuffer(["제1조(계약기간)", "이것은 절대 저장되면 안 되는 실패한 버전입니다."]);
    const uploaded = await uploadContractFile({
      userId: owner.id, organizationId: org.id, contractId,
      originalName: "v2-fails.docx", mimeType: DOCX_MIME, buffer,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const documentCountBefore = await prisma.contractExtractedDocument.count({ where: { contractId } });

    const extractionJob = await createExtractionJob({ userId: owner.id, organizationId: org.id, contractId, input: { contractFileId: uploaded.id } });
    await drain(processNextExtractionJob, "v2-extract-fail");

    const job = await prisma.contractExtractionJob.findUniqueOrThrow({ where: { id: extractionJob.jobId } });
    expect(job.status).toBe(ExtractionJobStatus.FAILED);
    expect(job.errorCode).toBe("INVALID_PROVIDER_RESPONSE");

    const documentCountAfter = await prisma.contractExtractedDocument.count({ where: { contractId } });
    expect(documentCountAfter).toBe(documentCountBefore); // no new document was created
  });

  it("V1 remains the exclusive authoritative revision after V2's failure - clause leg, chunk leg, and the final answer all still reflect V1, with zero partial V2 content", async () => {
    const clauseResults = await hybridSearchClauses({ organizationId: org.id, question: QUESTION, topK: 20 });
    const chunkResults = await hybridSearchDocumentChunks({ organizationId: org.id, question: QUESTION, topK: 20 });
    expect(clauseResults.some((r) => r.text.includes(V1_MARKER))).toBe(true);
    expect(chunkResults.some((r) => r.text.includes(V1_MARKER))).toBe(true);
    for (const result of [...clauseResults, ...chunkResults]) {
      expect(result.text).not.toContain("실패한 버전");
    }

    const result = await askQuestion({ organizationId: org.id, question: QUESTION });
    expect(result.sufficient).toBe(true);
    expect(result.answerText).toContain("2027");
    expect(result.answerText).not.toContain("실패한 버전");
  });
});
