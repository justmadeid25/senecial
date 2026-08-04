import { randomUUID } from "node:crypto";

import { Document, Packer, Paragraph } from "docx";

import { Prisma } from "@/generated/prisma/client";
import { computeHashingTrickEmbedding } from "@/domain/ai/hashing-trick-embedding";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { serializeVectorForPg } from "@/domain/ai/vector-validation";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { prisma } from "@/server/db/client";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EMBEDDING_PROVIDER = "development";
const EMBEDDING_MODEL = "hashing-trick-v1";

/**
 * §Phase 12.1 Part 18 (Benchmark) - real, varied Korean legal-clause-shaped
 * text, not "clause N" placeholders - different templates AND different
 * embedded numbers per row so the hashing-trick embedding actually differs
 * row to row (a benchmark corpus that is all-identical vectors would make
 * every distance computation trivial and non-representative).
 */
const CLAUSE_TEMPLATES: Array<(n: number) => string> = [
  (n) => `제${(n % 50) + 1}조(계약기간) 본 계약의 유효기간은 체결일로부터 ${(n % 36) + 1}개월로 한다.`,
  (n) => `제${(n % 50) + 1}조(대금지급) 발주자는 용역 완료 후 ${(n % 60) + 1}일 이내에 대금 ${(n % 900 + 100) * 10000}원을 지급하여야 한다.`,
  (n) => `제${(n % 50) + 1}조(손해배상) 당사자는 고의 또는 과실로 상대방에게 손해를 끼친 경우 그 손해액의 ${(n % 100) + 1}%를 배상하여야 한다.`,
  (n) => `제${(n % 50) + 1}조(비밀유지) 양 당사자는 계약 종료 후 ${(n % 5) + 1}년간 상대방의 영업비밀을 제3자에게 누설하여서는 안 된다.`,
  (n) => `제${(n % 50) + 1}조(해지) 일방 당사자가 계약을 ${(n % 3) + 1}회 이상 위반하는 경우 상대방은 서면 통지로 계약을 해지할 수 있다.`,
  (n) => `제${(n % 50) + 1}조(통지) 모든 통지는 서면으로 하며 상대방에게 도달한 날로부터 ${(n % 14) + 1}일 이내에 효력이 발생한다.`,
  (n) => `제${(n % 50) + 1}조(지식재산권) 본 계약의 수행 결과물에 대한 지식재산권은 ${(n % 2) === 0 ? "발주자" : "수행자"}에게 귀속된다.`,
  (n) => `제${(n % 50) + 1}조(불가항력) 천재지변 등 불가항력 사유로 이행이 지연되는 경우 그 지연기간만큼 이행기한을 ${(n % 30) + 1}일 연장한다.`,
];

export function generateSyntheticClauseText(index: number): string {
  const template = CLAUSE_TEMPLATES[index % CLAUSE_TEMPLATES.length]!;
  return template(index);
}

async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export interface BenchmarkSeedDocument {
  contractId: string;
  extractedDocumentId: string;
  segmentationJobId: string;
}

/**
 * Creates a small number of REAL contracts through the actual
 * upload -> extraction -> segmentation pipeline (same helpers every other
 * integration test in this codebase uses) - this is what makes every
 * synthetic clause's (contractId, extractedDocumentId, segmentationJobId)
 * foreign keys genuinely valid, real rows, not fabricated ids. Bulk
 * synthetic clause/embedding rows (see bulkInsertSyntheticClauses) are
 * then parented under these few real documents - the vector search
 * benchmark cares about total row COUNT and realistic vector content, not
 * about there being one real document per clause.
 */
export async function createBenchmarkSeedDocuments(params: {
  organizationId: string;
  userId: string;
  count: number;
}): Promise<BenchmarkSeedDocument[]> {
  const docs: BenchmarkSeedDocument[] = [];

  for (let i = 0; i < params.count; i += 1) {
    const created = await createContract({
      userId: params.userId,
      organizationId: params.organizationId,
      input: {
        title: `벡터 검색 벤치마크 시드 계약 ${i + 1}`,
        contractType: "SERVICE",
        status: "ACTIVE",
        autoRenewal: false,
        currency: "KRW",
      },
    });

    const buffer = await buildDocxBuffer([
      `제1조(시드 조항)`,
      `이 조항은 벤치마크용 시드 문서 ${i + 1}번의 최초 조항입니다.`,
    ]);
    const uploaded = await uploadContractFile({
      userId: params.userId,
      organizationId: params.organizationId,
      contractId: created.id,
      originalName: `benchmark-seed-${i + 1}.docx`,
      mimeType: DOCX_MIME,
      buffer,
    });

    const extractionJob = await createExtractionJob({
      userId: params.userId,
      organizationId: params.organizationId,
      contractId: created.id,
      input: { contractFileId: uploaded.id },
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!(await processNextExtractionJob(`benchmark-seed-extract-${i}-${attempt}`)).processed) break;
    }

    const document = await prisma.contractExtractedDocument.findFirstOrThrow({
      where: { extractionJobId: extractionJob.jobId },
    });

    const segmentationJob = await createClauseSegmentationJob({
      userId: params.userId,
      organizationId: params.organizationId,
      contractId: created.id,
      input: { extractedDocumentId: document.id },
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!(await processNextClauseSegmentationJob(`benchmark-seed-segment-${i}-${attempt}`)).processed) break;
    }

    docs.push({ contractId: created.id, extractedDocumentId: document.id, segmentationJobId: segmentationJob.jobId });
  }

  return docs;
}

export interface BulkInsertResult {
  clausesInserted: number;
  embeddingsInserted: number;
  elapsedMs: number;
}

/**
 * §Phase 12.1 Part 18 - bulk-inserts `targetCount` synthetic clauses,
 * round-robined across `seedDocs`, each with a REAL hashing-trick
 * embedding (both the `vector` Float[] fallback AND the native
 * `vectorNative` pgvector column, dual-written exactly like
 * createLatestClauseEmbedding() does for real embeddings - see that
 * function's own docstring). Batched (ContractClause via
 * `createMany`, ClauseEmbedding via raw multi-row INSERT, since
 * `vectorNative` is an Unsupported type Prisma Client cannot write
 * through its normal API) to keep this feasible at real scale.
 */
export async function bulkInsertSyntheticClauses(params: {
  organizationId: string;
  seedDocs: readonly BenchmarkSeedDocument[];
  targetCount: number;
  batchSize?: number;
  /** Set this to the PREVIOUS call's `targetCount` (or running total) when calling this function more than once for the same organization/seedDocs - orderIndex is unique per segmentationJobId, and every call starts counting from 0 by default, which would otherwise collide with a prior call's rows. */
  startIndex?: number;
  onProgress?: (inserted: number, elapsedMs: number) => void;
}): Promise<BulkInsertResult> {
  const batchSize = params.batchSize ?? 1000;
  const startIndex = params.startIndex ?? 0;
  const start = performance.now();
  let clausesInserted = 0;
  let embeddingsInserted = 0;

  for (let batchStart = 0; batchStart < params.targetCount; batchStart += batchSize) {
    const batchCount = Math.min(batchSize, params.targetCount - batchStart);

    const clauseRows: Array<{
      id: string;
      contractClauseId: string;
      text: string;
      normalizedText: string;
      contractId: string;
      extractedDocumentId: string;
      segmentationJobId: string;
    }> = [];

    for (let i = 0; i < batchCount; i += 1) {
      const globalIndex = startIndex + batchStart + i;
      const seedDoc = params.seedDocs[globalIndex % params.seedDocs.length]!;
      const text = generateSyntheticClauseText(globalIndex);
      const normalizedText = normalizeClauseText(text);
      const id = randomUUID();
      clauseRows.push({
        id,
        contractClauseId: id,
        text,
        normalizedText,
        contractId: seedDoc.contractId,
        extractedDocumentId: seedDoc.extractedDocumentId,
        segmentationJobId: seedDoc.segmentationJobId,
      });
    }

    await prisma.contractClause.createMany({
      data: clauseRows.map((row, i) => ({
        id: row.id,
        organizationId: params.organizationId,
        contractId: row.contractId,
        extractedDocumentId: row.extractedDocumentId,
        segmentationJobId: row.segmentationJobId,
        clauseNumber: `제${(startIndex + batchStart + i) % 50 + 1}조`,
        text: row.text,
        normalizedText: row.normalizedText,
        // Offset well above any real seed clause's own orderIndex (each
        // seed document's single real clause starts at 0) - orderIndex
        // must be unique per segmentationJobId, and multiple synthetic
        // rows share a job (round-robined across seedDocs), so this must
        // never collide with either the seed clause, another synthetic
        // row parented under the same job, OR a previous call to this
        // function for the same organization (see `startIndex`).
        orderIndex: 1_000_000 + startIndex + batchStart + i,
        depth: 0,
        startOffset: 0,
        endOffset: row.text.length,
      })),
    });
    clausesInserted += clauseRows.length;

    const embeddingValues = clauseRows.map((row) => {
      const vector = computeHashingTrickEmbedding(row.normalizedText, VECTOR_NATIVE_DIMENSION);
      const serialized = serializeVectorForPg(vector, VECTOR_NATIVE_DIMENSION);
      return Prisma.sql`(
        ${randomUUID()}, ${params.organizationId}, ${row.contractClauseId}, ${EMBEDDING_PROVIDER}, ${EMBEDDING_MODEL},
        ${VECTOR_NATIVE_DIMENSION}, ${vector}::double precision[], ${serialized}::vector, 'benchmark', 1, true, now()
      )`;
    });

    await prisma.$executeRaw`
      INSERT INTO "clause_embeddings"
        ("id", "organizationId", "contractClauseId", "provider", "model", "dimension", "vector", "vectorNative", "checksum", "embeddingVersion", "isLatest", "createdAt")
      VALUES ${Prisma.join(embeddingValues)}
    `;
    embeddingsInserted += embeddingValues.length;

    params.onProgress?.(clausesInserted, performance.now() - start);
  }

  return { clausesInserted, embeddingsInserted, elapsedMs: performance.now() - start };
}
