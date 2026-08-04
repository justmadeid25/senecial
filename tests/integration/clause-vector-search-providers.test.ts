import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { computeHashingTrickEmbedding } from "@/domain/ai/hashing-trick-embedding";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { runVectorBackfill } from "@/features/ai/server/run-vector-backfill";
import { ApplicationCosineClauseSearchProvider } from "@/server/services/ai/vector-search/application-cosine-clause-search-provider";
import { PgVectorClauseSearchProvider } from "@/server/services/ai/vector-search/pgvector-clause-search-provider";
import { deleteContract } from "@/features/contracts/server/delete-contract";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "clause-vector-search-provider-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EMBEDDING_PROVIDER = "development";
const EMBEDDING_MODEL = "hashing-trick-v1";

const SAMPLE_LINES = [
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
let ownerB: { id: string };
let contractId: string;
let deletedContractId: string;
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

async function uploadAndProcessContract(params: { organizationId: string; userId: string; title: string; lines: string[] }) {
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
    data: { name: "Clause Vector Search Test Org A", slug: `clause-vector-search-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Clause Vector Search Test Org B", slug: `clause-vector-search-test-b-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Vector Search Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  ownerB = await prisma.user.create({
    data: {
      name: "Vector Search Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });

  contractId = await uploadAndProcessContract({
    organizationId: orgA.id,
    userId: owner.id,
    title: "벡터 검색 provider 테스트 계약",
    lines: SAMPLE_LINES,
  });

  deletedContractId = await uploadAndProcessContract({
    organizationId: orgA.id,
    userId: owner.id,
    title: "삭제될 계약 (벡터 검색에서 제외되어야 함)",
    lines: ["제1조(해지)", "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다."],
  });

  await uploadAndProcessContract({
    organizationId: orgB.id,
    userId: ownerB.id,
    title: "다른 조직 계약 (격리 확인용)",
    lines: ["제1조(해지)", "어느 일방이 본 계약을 위반한 경우 상대방은 서면 통지로 즉시 계약을 해지할 수 있다."],
  });

  await drainAllPendingEmbeddingJobs();
  await runVectorBackfill({ limit: 10_000 });

  // Soft-delete after embedding/backfill so its embeddings genuinely exist
  // in the DB (proving the exclusion is a real query-time filter, not just
  // "never got embedded in the first place").
  await deleteContract({ userId: owner.id, organizationId: orgA.id, contractId: deletedContractId });
}, 60_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
  await prisma.clauseEmbedding.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.embeddingJob.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractClause.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractSection.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractExtractionJob.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
});

function buildQueryVector(question: string): number[] {
  return computeHashingTrickEmbedding(normalizeClauseText(question));
}

for (const [providerName, ProviderClass] of [
  ["application", ApplicationCosineClauseSearchProvider],
  ["pgvector", PgVectorClauseSearchProvider],
] as const) {
  describe(`${providerName} ClauseVectorSearchProvider (Phase 12.1 §8/§9/§21, real DB)`, () => {
    const provider = new ProviderClass();

    it("returns all 3 live clauses from orgA, sorted descending by vector similarity", async () => {
      // This provider is a PURE vector leg (no keyword matching - that is
      // hybridSearchClauses's separate job, see hybrid-search-clauses.ts).
      // The Development embedding (char-trigram hashing-trick) does not
      // reliably rank the semantically "correct" clause first on its
      // own - that is precisely why the real production pipeline weighs
      // it together with a keyword leg (already covered by
      // tests/integration/hybrid-search.test.ts). This test instead
      // verifies what a raw vector provider actually promises: a
      // complete, correctly-ordered result set.
      const results = await provider.search({
        organizationId: orgA.id,
        queryVector: buildQueryVector("계약을 해지하려면 어떻게 해야 하나요?"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 5,
      });
      expect(results).toHaveLength(3);
      for (let i = 1; i < results.length; i += 1) {
        expect(results[i]!.vectorScore).toBeLessThanOrEqual(results[i - 1]!.vectorScore + 1e-9);
      }
    });

    it("§Security Tenant Isolation - never returns a clause from a different organization", async () => {
      const results = await provider.search({
        organizationId: orgA.id,
        queryVector: buildQueryVector("계약 해지"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 20,
      });
      expect(results.every((r) => r.contractId !== undefined)).toBe(true);
      const orgBResults = await provider.search({
        organizationId: orgB.id,
        queryVector: buildQueryVector("완전히 무관한 질문"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 20,
      });
      expect(orgBResults.every((r) => r.contractId !== contractId && r.contractId !== deletedContractId)).toBe(true);
    });

    it("§9 - never returns a clause from a soft-deleted contract, even though its embedding still exists in the DB", async () => {
      const results = await provider.search({
        organizationId: orgA.id,
        queryVector: buildQueryVector("계약을 해지하려면 어떻게 해야 하나요?"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 20,
      });
      expect(results.some((r) => r.contractId === deletedContractId)).toBe(false);

      const stillHasEmbedding = await prisma.clauseEmbedding.findFirst({
        where: { contractClause: { contractId: deletedContractId } },
      });
      expect(stillHasEmbedding).not.toBeNull(); // sanity - the exclusion is a query-time filter, not "never embedded"
    });

    it("returns an empty array (never throws) for an organization with no eligible content", async () => {
      const emptyOrg = await prisma.organization.create({
        data: { name: "Empty Org", slug: `clause-vector-search-empty-${Date.now()}` },
      });
      const results = await provider.search({
        organizationId: emptyOrg.id,
        queryVector: buildQueryVector("아무 질문"),
        embeddingProvider: EMBEDDING_PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        topK: 5,
      });
      expect(results).toEqual([]);
      await prisma.organization.delete({ where: { id: emptyOrg.id } });
    });

    it("never returns a row whose embedding provider/model does not match the request", async () => {
      const results = await provider.search({
        organizationId: orgA.id,
        queryVector: buildQueryVector("계약 해지"),
        embeddingProvider: "some-other-provider",
        embeddingModel: "some-other-model",
        topK: 20,
      });
      expect(results).toEqual([]);
    });
  });
}

describe("application vs pgvector provider agreement (Phase 12.1 §17 preview - full comparison is §43's dedicated CLI)", () => {
  it("both providers agree on the exact top-1 result and full ranking for the same query", async () => {
    const queryVector = buildQueryVector("영업비밀 누설 금지 조항이 있나요?");
    const applicationResults = await new ApplicationCosineClauseSearchProvider().search({
      organizationId: orgA.id,
      queryVector,
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: EMBEDDING_MODEL,
      topK: 5,
    });
    const pgvectorResults = await new PgVectorClauseSearchProvider().search({
      organizationId: orgA.id,
      queryVector,
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: EMBEDDING_MODEL,
      topK: 5,
    });

    expect(pgvectorResults.map((r) => r.contractClauseId)).toEqual(applicationResults.map((r) => r.contractClauseId));
    for (let i = 0; i < applicationResults.length; i += 1) {
      expect(pgvectorResults[i]!.vectorScore).toBeCloseTo(applicationResults[i]!.vectorScore, 3);
    }
  });
});
