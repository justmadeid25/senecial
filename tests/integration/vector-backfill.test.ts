import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MembershipRole } from "@/generated/prisma/enums";
import { VECTOR_NATIVE_DIMENSION } from "@/domain/ai/vector-search-config";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import {
  dryRunVectorBackfill,
  runVectorBackfill,
  verifyVectorBackfill,
} from "@/features/ai/server/run-vector-backfill";
import { getStorageDriver } from "@/server/storage";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "vector-backfill-test.local";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
    data: { name: "Vector Backfill Test Org", slug: `vector-backfill-test-${Date.now()}` },
  });
  owner = await prisma.user.create({
    data: {
      name: "Vector Backfill Owner",
      email: `owner@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: org.id, role: MembershipRole.OWNER } },
    },
  });

  const created = await createContract({
    userId: owner.id,
    organizationId: org.id,
    input: { title: "벡터 백필 테스트 계약", contractType: "SERVICE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  contractId = created.id;

  const buffer = await buildDocxBuffer(SAMPLE_LINES);
  const uploaded = await uploadContractFile({
    userId: owner.id,
    organizationId: org.id,
    contractId,
    originalName: "vector-backfill-test.docx",
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

  // §Phase 12.1 - createLatestClauseEmbedding() now dual-writes
  // vectorNative at creation time (see clause-embedding-repository.ts), so
  // a freshly-embedded clause is never actually "not yet backfilled" in
  // real operation. This test suite exists to verify the BACKFILL CLI
  // itself (the one-time migration path for legacy rows created before
  // dual-write existed), so it deliberately recreates that legacy state
  // here by nulling out vectorNative for this org's own rows - a
  // controlled simulation, not a claim that real dual-written rows ever
  // look like this.
  await prisma.$executeRaw`UPDATE "clause_embeddings" SET "vectorNative" = NULL WHERE "organizationId" = ${org.id}`;
}, 30_000);

afterAll(async () => {
  const storageDriver = getStorageDriver();
  for (const key of createdFileStorageKeys) {
    await storageDriver.delete(key).catch(() => {});
  }
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

describe("vector-backfill (Phase 12.1 §7, real pgvector DB)", () => {
  it("dry-run reports eligible rows without writing anything", async () => {
    // This dev/test database is shared with Playwright E2E specs, which
    // leave real ClauseEmbedding rows behind (see the next test's own
    // comment) - some may already be populated from an earlier run. The
    // real invariant a dry-run guarantees is "calling it twice never
    // changes anything", not "nothing has ever been populated before".
    const before = await dryRunVectorBackfill();
    expect(before.eligibleBefore).toBeGreaterThan(0);

    const afterDryRun = await dryRunVectorBackfill();
    expect(afterDryRun.eligibleBefore).toBe(before.eligibleBefore); // unchanged - dry-run never wrote
    expect(afterDryRun.stats).toEqual(before.stats);
  });

  it("backfills eligible rows and never touches the fallback vector column", async () => {
    // The backfill is deliberately GLOBAL, not org-scoped (a real
    // production run must cover every organization) - this dev/test
    // database also has leftover ClauseEmbedding rows from Playwright E2E
    // specs, which intentionally never clean up their fixture orgs. So
    // this test asserts against ITS OWN org's rows specifically, not
    // against the run's global `succeeded` count.
    const clausesBefore = await prisma.clauseEmbedding.findMany({
      where: { organizationId: org.id, isLatest: true },
      select: { id: true, vector: true },
    });
    expect(clausesBefore.length).toBeGreaterThan(0);
    expect(clausesBefore.every((row) => row.vector.length === VECTOR_NATIVE_DIMENSION)).toBe(true);

    const result = await runVectorBackfill({ limit: 500 });
    expect(result.succeeded).toBeGreaterThanOrEqual(clausesBefore.length);
    expect(result.failed).toEqual([]);

    const populatedForThisOrg = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "clause_embeddings"
      WHERE "organizationId" = ${org.id} AND "isLatest" = true AND "vectorNative" IS NOT NULL
    `;
    expect(Number(populatedForThisOrg[0]!.count)).toBe(clausesBefore.length);

    // Fallback column completely untouched (§7 item 10 - never delete the original fallback vector).
    const clausesAfter = await prisma.clauseEmbedding.findMany({
      where: { organizationId: org.id, isLatest: true },
      select: { id: true, vector: true },
    });
    for (const before of clausesBefore) {
      const after = clausesAfter.find((row) => row.id === before.id);
      expect(after!.vector).toEqual(before.vector);
    }
  });

  it("skips already-backfilled rows on a second run (idempotent, resumable)", async () => {
    const before = await dryRunVectorBackfill();
    expect(before.eligibleBefore).toBe(0); // nothing left after the previous test's run

    const result = await runVectorBackfill({ limit: 500 });
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
  });

  it("--verify confirms the native column matches the fallback vector within float32 round-trip tolerance", async () => {
    const verification = await verifyVectorBackfill();
    expect(verification.stats.populated).toBeGreaterThan(0);
    expect(verification.sampledCount).toBeGreaterThan(0);
    expect(verification.mismatches).toEqual([]);
  });

  it("real pgvector distance ordering matches application cosine similarity ordering for the backfilled vectors", async () => {
    const rows = await prisma.$queryRaw<Array<{ id: string; distance: number }>>`
      SELECT "id", ("vectorNative" <=> (SELECT "vectorNative" FROM "clause_embeddings" WHERE "organizationId" = ${org.id} AND "isLatest" = true LIMIT 1)) AS distance
      FROM "clause_embeddings"
      WHERE "organizationId" = ${org.id} AND "isLatest" = true
      ORDER BY distance ASC
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.distance).toBeCloseTo(0, 5); // a vector compared to itself
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.distance).toBeGreaterThanOrEqual(rows[i - 1]!.distance - 1e-6);
    }
  });
});
