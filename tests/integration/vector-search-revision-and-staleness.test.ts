import { randomUUID } from "node:crypto";

import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { computeHashingTrickEmbedding } from "@/domain/ai/hashing-trick-embedding";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { ApplicationCosineClauseSearchProvider } from "@/server/services/ai/vector-search/application-cosine-clause-search-provider";
import { PgVectorClauseSearchProvider } from "@/server/services/ai/vector-search/pgvector-clause-search-provider";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "vector-search-revision-staleness-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EMBEDDING_PROVIDER = "development";
const EMBEDDING_MODEL = "hashing-trick-v1";

let org: { id: string };
let owner: { id: string };
let contractId: string;
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

async function insertClauseWithEmbedding(params: {
  segmentationJobId: string;
  extractedDocumentId: string;
  orderIndex: number;
  text: string;
  vectorNative: "populate" | "null";
}): Promise<string> {
  const clauseId = randomUUID();
  const normalizedText = normalizeClauseText(params.text);
  await prisma.contractClause.create({
    data: {
      id: clauseId,
      organizationId: org.id,
      contractId,
      extractedDocumentId: params.extractedDocumentId,
      segmentationJobId: params.segmentationJobId,
      text: params.text,
      normalizedText,
      orderIndex: params.orderIndex,
      depth: 0,
      startOffset: 0,
      endOffset: params.text.length,
    },
  });

  const vector = computeHashingTrickEmbedding(normalizedText, VECTOR_NATIVE_DIMENSION);
  const embeddingId = randomUUID();
  if (params.vectorNative === "populate") {
    const serialized = serializeVectorForPg(vector, VECTOR_NATIVE_DIMENSION);
    await prisma.$executeRaw`
      INSERT INTO "clause_embeddings"
        ("id", "organizationId", "contractClauseId", "provider", "model", "dimension", "vector", "vectorNative", "checksum", "embeddingVersion", "isLatest", "createdAt")
      VALUES (${embeddingId}, ${org.id}, ${clauseId}, ${EMBEDDING_PROVIDER}, ${EMBEDDING_MODEL}, ${VECTOR_NATIVE_DIMENSION}, ${vector}::double precision[], ${serialized}::vector, 'test', 1, true, now())
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "clause_embeddings"
        ("id", "organizationId", "contractClauseId", "provider", "model", "dimension", "vector", "vectorNative", "checksum", "embeddingVersion", "isLatest", "createdAt")
      VALUES (${embeddingId}, ${org.id}, ${clauseId}, ${EMBEDDING_PROVIDER}, ${EMBEDDING_MODEL}, ${VECTOR_NATIVE_DIMENSION}, ${vector}::double precision[], NULL, 'test', 1, true, now())
    `;
  }

  return clauseId;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  org = await prisma.organization.create({
    data: { name: "Vector Search Revision/Staleness Test Org", slug: `vector-search-revstale-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Vector Search Revision/Staleness Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "리비전/staleness 테스트 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(["제1조(현재 리비전 조항)", "이 조항은 현재(최신) 분해 결과에 속합니다."]);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "revision-staleness-test.docx",
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
  // Note: no embedding worker drain here - this test inserts its own
  // clauses/embeddings directly (see insertClauseWithEmbedding) rather
  // than relying on the real embedding job queue, since it needs precise
  // control over vectorNative population per row.

  const currentJob = await prisma.clauseSegmentationJob.findFirstOrThrow({
    where: { organizationId: org.id, contractId, status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } },
  });

  // §21 item 7 - simulate a STALE prior segmentation revision: an older,
  // already-superseded ClauseSegmentationJob for the SAME document,
  // completed before the current one. In real operation this only arises
  // when CLAUSE_SEGMENTER_VERSION changes and a document gets
  // re-segmented - directly inserting the row here is the only practical
  // way to exercise that (rare, version-bump-only) path without actually
  // changing the segmenter version.
  const staleJob = await prisma.clauseSegmentationJob.create({
    data: {
      organizationId: org.id,
      contractId,
      extractedDocumentId: document.id,
      status: "COMPLETED",
      segmenterVersion: "stale-test-version-0",
      inputChecksum: "stale-test-checksum",
      jobKey: `stale-test-job-key-${randomUUID()}`,
      createdById: owner.id,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  });

  await insertClauseWithEmbedding({
    segmentationJobId: staleJob.id,
    extractedDocumentId: document.id,
    orderIndex: 500,
    text: "제1조(과거 리비전 조항) 이 조항은 과거(재분해로 대체된) 리비전에 속하며 검색에 나타나서는 안 됩니다.",
    vectorNative: "populate",
  });

  await insertClauseWithEmbedding({
    segmentationJobId: currentJob.id,
    extractedDocumentId: document.id,
    orderIndex: 501,
    text: "제2조(현재 리비전 조항) 이 조항은 현재 리비전에 속하며 검색에 나타나야 합니다.",
    vectorNative: "populate",
  });

  await insertClauseWithEmbedding({
    segmentationJobId: currentJob.id,
    extractedDocumentId: document.id,
    orderIndex: 502,
    text: "제3조(아직 백필되지 않은 조항) 이 조항은 vectorNative가 아직 채워지지 않은 상태를 시뮬레이션합니다.",
    vectorNative: "null",
  });
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: org.id } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractClause.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractSection.deleteMany({ where: { organizationId: org.id } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.contractFile.deleteMany({ where: { organizationId: org.id } });
  await prisma.contract.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

function buildQueryVector(text: string): number[] {
  return computeHashingTrickEmbedding(normalizeClauseText(text), VECTOR_NATIVE_DIMENSION);
}

describe("§21 item 7 - only the latest segmentation revision is ever searched", () => {
  for (const [providerName, ProviderClass] of [
    ["application", ApplicationCosineClauseSearchProvider],
    ["pgvector", PgVectorClauseSearchProvider],
  ] as const) {
    it(`${providerName}: never returns a clause parented under a superseded (stale) segmentation revision`, async () => {
      const provider = new ProviderClass();
      const results = await provider.search({
        organizationId: org.id,
        queryVector: buildQueryVector("리비전 조항"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 20,
      });

      expect(results.some((r) => r.text.includes("과거(재분해로 대체된) 리비전"))).toBe(false);
      expect(results.some((r) => r.text.includes("현재 리비전에 속하며"))).toBe(true);
    });
  }
});

describe("§21 item 8/10 - a not-yet-backfilled (stale) embedding is excluded from pgvector but still visible via the application fallback", () => {
  it("pgvector never returns a row whose vectorNative is NULL", async () => {
    const results = await new PgVectorClauseSearchProvider().search({
      organizationId: org.id,
      queryVector: buildQueryVector("아직 백필되지 않은 조항"),
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: EMBEDDING_MODEL,
      topK: 20,
    });
    expect(results.some((r) => r.text.includes("아직 채워지지 않은 상태"))).toBe(false);
  });

  it("the application provider (which never checks vectorNative) still returns that same row", async () => {
    const results = await new ApplicationCosineClauseSearchProvider().search({
      organizationId: org.id,
      queryVector: buildQueryVector("아직 백필되지 않은 조항"),
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: EMBEDDING_MODEL,
      topK: 20,
    });
    expect(results.some((r) => r.text.includes("아직 채워지지 않은 상태"))).toBe(true);
  });
});
