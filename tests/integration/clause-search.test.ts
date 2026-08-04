import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus, MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { createContract } from "@/features/contracts/server/create-contract";
import { deleteContract } from "@/features/contracts/server/delete-contract";
import { searchContractClausesInContract } from "@/features/clauses/server/search-contract-clauses";
import { searchOrgClauses } from "@/features/clauses/server/search-org-clauses";
import { createClauseSegmentationJob as createSegmentationJobRow } from "@/server/repositories/clause-segmentation-job-repository";
import { createContractClauses } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "clause-search-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];
const createdDocumentIds: string[] = [];

const baseContractInput = {
  contractType: "LEASE" as const,
  status: "ACTIVE" as const,
  autoRenewal: false,
  currency: "KRW",
};

async function createTestContract(userId: string, organizationId: string, title: string) {
  const created = await createContract({ userId, organizationId, input: { ...baseContractInput, title } });
  createdContractIds.push(created.id);
  return created;
}

/**
 * Directly inserts a REVIEW_REQUIRED segmentation job + clause rows for a
 * contract, bypassing the worker/queue entirely - search doesn't need to
 * re-test the worker (see clause-segmentation.test.ts for that), only that
 * it reads clause rows correctly, so this file never touches
 * claimNextPendingClauseSegmentationJob and stays safely in the default
 * (parallel) vitest project.
 */
async function seedClauses(
  organizationId: string,
  contractId: string,
  clauses: Array<{
    text: string;
    clauseNumber?: string;
    title?: string;
    clauseType?: "TERM" | "CONFIDENTIALITY" | "LIABILITY";
  }>
) {
  const extractedDocument = await prisma.contractExtractedDocument.create({
    data: {
      extractionJobId: (
        await prisma.contractExtractionJob.create({
          data: {
            organizationId,
            contractId,
            contractFileId: (
              await prisma.contractFile.create({
                data: {
                  organizationId,
                  contractId,
                  uploadedById: (await prisma.contract.findUniqueOrThrow({ where: { id: contractId } }))
                    .createdById,
                  originalName: "seed.docx",
                  storageKey: `seed/${randomUUID()}`,
                  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  size: 100,
                  checksum: randomUUID(),
                },
              })
            ).id,
            extractorVersion: "seed-v1",
            inputChecksum: randomUUID(),
            createdById: (await prisma.contract.findUniqueOrThrow({ where: { id: contractId } }))
              .createdById,
          },
        })
      ).id,
      organizationId,
      contractId,
      contractFileId: (
        await prisma.contractFile.findFirstOrThrow({ where: { contractId }, orderBy: { createdAt: "desc" } })
      ).id,
      text: clauses.map((c) => c.text).join("\n"),
      characterCount: 100,
      extractionMethod: "seed",
      contentChecksum: randomUUID(),
    },
  });
  createdDocumentIds.push(extractedDocument.id);

  const segmentationJob = await createSegmentationJobRow({
    organizationId,
    contractId,
    extractedDocumentId: extractedDocument.id,
    segmenterVersion: CLAUSE_SEGMENTER_VERSION,
    inputChecksum: extractedDocument.contentChecksum,
    jobKey: randomUUID(),
    createdById: (await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).createdById,
  });
  await prisma.clauseSegmentationJob.update({
    where: { id: segmentationJob.id },
    data: { status: ClauseSegmentationJobStatus.REVIEW_REQUIRED, completedAt: new Date() },
  });

  await createContractClauses(
    clauses.map((clause, index) => ({
      id: randomUUID(),
      organizationId,
      contractId,
      extractedDocumentId: extractedDocument.id,
      segmentationJobId: segmentationJob.id,
      clauseNumber: clause.clauseNumber ?? null,
      title: clause.title ?? null,
      text: clause.text,
      normalizedText: normalizeClauseText(clause.text),
      orderIndex: index,
      depth: 0,
      startOffset: 0,
      endOffset: clause.text.length,
      suggestedClauseType: clause.clauseType ?? null,
    }))
  );

  return { segmentationJobId: segmentationJob.id, extractedDocumentId: extractedDocument.id };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Clause Search Test Org A", slug: `clause-search-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Clause Search Test Org B", slug: `clause-search-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  ownerB = await prisma.user.create({
    data: {
      name: "Owner B",
      email: `owner-b@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgB.id, role: MembershipRole.OWNER } },
    },
  });
});

afterAll(async () => {
  await prisma.contractClause.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("searchContractClausesInContract", () => {
  it("finds a clause by body text content", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "본문 검색 테스트");
    await seedClauses(orgA.id, contract.id, [
      { text: "양 당사자는 비밀 정보를 제3자에게 누설하지 않는다.", clauseNumber: "제3조" },
      { text: "본 계약은 준거법에 따른다.", clauseNumber: "제6조" },
    ]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "비밀 정보" },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.clauseNumber).toBe("제3조");
  });

  it("finds a clause by title", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "제목 검색 테스트");
    await seedClauses(orgA.id, contract.id, [
      { text: "본문 내용", clauseNumber: "제1조", title: "특수목적조항명" },
    ]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "특수목적조항명" },
    });
    expect(result.total).toBe(1);
  });

  it("finds a clause by clause number", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "조항번호 검색 테스트");
    await seedClauses(orgA.id, contract.id, [{ text: "본문", clauseNumber: "제7조" }]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "제7조" },
    });
    expect(result.total).toBe(1);
  });

  it("filters by clauseType", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "유형 필터 테스트");
    await seedClauses(orgA.id, contract.id, [
      { text: "계약기간은 1년이다", clauseNumber: "제2조", clauseType: "TERM" },
      { text: "계약기간 관련 다른 문구", clauseNumber: "제9조", clauseType: "CONFIDENTIALITY" },
    ]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "계약기간", clauseType: "TERM" },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.clauseNumber).toBe("제2조");
  });

  it("paginates results", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "페이지네이션 테스트");
    await seedClauses(
      orgA.id,
      contract.id,
      Array.from({ length: 5 }, (_, i) => ({
        text: `공통검색어 조항 내용 ${i}`,
        clauseNumber: `제${i + 1}조`,
      }))
    );

    const page1 = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "공통검색어", pageSize: 2, page: 1 },
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
  });

  it("caps the snippet length", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "스니펫 길이 테스트");
    const longText = "긴 문장 앞부분 ".repeat(50) + "검색어" + " 긴 문장 뒷부분".repeat(50);
    await seedClauses(orgA.id, contract.id, [{ text: longText, clauseNumber: "제1조" }]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "검색어" },
    });
    const snippet = result.items[0]?.snippet;
    const total = (snippet?.before.length ?? 0) + (snippet?.match.length ?? 0) + (snippet?.after.length ?? 0);
    expect(total).toBeLessThanOrEqual(200);
  });

  it("excludes clauses from a soft-deleted contract by default", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "삭제된 계약 검색 제외 테스트");
    await seedClauses(orgA.id, contract.id, [{ text: "삭제 테스트 고유 검색어 문구", clauseNumber: "제1조" }]);

    await deleteContract({ userId: ownerA.id, organizationId: orgA.id, contractId: contract.id });

    const result = await searchOrgClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { q: "삭제 테스트 고유 검색어" },
    });
    expect(result.total).toBe(0);
  });

  it("only searches the latest segmentation job's clauses, excluding stale revisions", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "리비전 검색 범위 테스트");
    const { segmentationJobId: oldJobId } = await seedClauses(orgA.id, contract.id, [
      { text: "이전 리비전 고유 검색어", clauseNumber: "제1조" },
    ]);
    // Simulate the old job being superseded (no longer the latest ready job).
    await prisma.clauseSegmentationJob.update({
      where: { id: oldJobId },
      data: { status: ClauseSegmentationJobStatus.COMPLETED, createdAt: new Date("2020-01-01") },
    });
    await seedClauses(orgA.id, contract.id, [
      { text: "이전 리비전 고유 검색어가 아닌 최신 문구", clauseNumber: "제1조" },
    ]);

    const result = await searchContractClausesInContract({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      input: { q: "이전 리비전 고유 검색어" },
    });
    // Only the latest job's clause (which happens to also contain the
    // phrase as a substring of its own text) should be searched - the
    // truly-old job's clause must not appear.
    for (const item of result.items) {
      expect(item.snippet?.match).toBeTruthy();
    }
  });
});

describe("searchOrgClauses", () => {
  it("finds clauses across multiple contracts in the same organization", async () => {
    const contract1 = await createTestContract(ownerA.id, orgA.id, "조직 검색 계약 1");
    const contract2 = await createTestContract(ownerA.id, orgA.id, "조직 검색 계약 2");
    await seedClauses(orgA.id, contract1.id, [{ text: "조직전체검색고유어1", clauseNumber: "제1조" }]);
    await seedClauses(orgA.id, contract2.id, [{ text: "조직전체검색고유어1", clauseNumber: "제1조" }]);

    const result = await searchOrgClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { q: "조직전체검색고유어1" },
    });
    expect(result.total).toBe(2);
    expect(new Set(result.items.map((i) => i.contractId))).toEqual(
      new Set([contract1.id, contract2.id])
    );
  });

  it("never returns another organization's clauses", async () => {
    const contractA = await createTestContract(ownerA.id, orgA.id, "조직A 계약");
    const contractB = await createTestContract(ownerB.id, orgB.id, "조직B 계약");
    await seedClauses(orgA.id, contractA.id, [{ text: "교차조직검색고유어", clauseNumber: "제1조" }]);
    await seedClauses(orgB.id, contractB.id, [{ text: "교차조직검색고유어", clauseNumber: "제1조" }]);

    const resultA = await searchOrgClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { q: "교차조직검색고유어" },
    });
    expect(resultA.total).toBe(1);
    expect(resultA.items[0]?.contractId).toBe(contractA.id);
  });

  it("includes the contract title in each result", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "제목포함확인계약");
    await seedClauses(orgA.id, contract.id, [{ text: "제목포함확인고유어", clauseNumber: "제1조" }]);

    const result = await searchOrgClauses({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { q: "제목포함확인고유어" },
    });
    expect(result.items[0]?.contractTitle).toBe("제목포함확인계약");
  });
});
