import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus, MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { createContract } from "@/features/contracts/server/create-contract";
import { compareClauseToStandard } from "@/features/clauses/server/compare-clause-to-standard";
import { createClauseStandard } from "@/features/clauses/server/create-clause-standard";
import { updateClauseStandard } from "@/features/clauses/server/update-clause-standard";
import { deleteClauseStandard } from "@/features/clauses/server/delete-clause-standard";
import { getClauseStandard } from "@/features/clauses/server/get-clause-standard";
import { listClauseStandardsByType } from "@/features/clauses/server/list-clause-standards-by-type";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createClauseSegmentationJob as createSegmentationJobRow } from "@/server/repositories/clause-segmentation-job-repository";
import { createContractClauses } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "clause-standards-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let memberA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];
const createdStandardIds: string[] = [];
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

/** Same direct-insert helper as clause-search.test.ts - stays out of the queue. */
async function seedClause(organizationId: string, contractId: string, text: string, createdById: string) {
  const file = await prisma.contractFile.create({
    data: {
      organizationId,
      contractId,
      uploadedById: createdById,
      originalName: "seed.docx",
      storageKey: `seed/${randomUUID()}`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      checksum: randomUUID(),
    },
  });
  const extractionJob = await prisma.contractExtractionJob.create({
    data: {
      organizationId,
      contractId,
      contractFileId: file.id,
      extractorVersion: "seed-v1",
      inputChecksum: randomUUID(),
      createdById,
    },
  });
  const document = await prisma.contractExtractedDocument.create({
    data: {
      extractionJobId: extractionJob.id,
      organizationId,
      contractId,
      contractFileId: file.id,
      text,
      characterCount: text.length,
      extractionMethod: "seed",
      contentChecksum: randomUUID(),
    },
  });
  createdDocumentIds.push(document.id);

  const segmentationJob = await createSegmentationJobRow({
    organizationId,
    contractId,
    extractedDocumentId: document.id,
    segmenterVersion: CLAUSE_SEGMENTER_VERSION,
    inputChecksum: document.contentChecksum,
    jobKey: randomUUID(),
    createdById,
  });
  await prisma.clauseSegmentationJob.update({
    where: { id: segmentationJob.id },
    data: { status: ClauseSegmentationJobStatus.REVIEW_REQUIRED, completedAt: new Date() },
  });

  const clauseId = randomUUID();
  await createContractClauses([
    {
      id: clauseId,
      organizationId,
      contractId,
      extractedDocumentId: document.id,
      segmentationJobId: segmentationJob.id,
      clauseNumber: "제1조",
      text,
      normalizedText: normalizeClauseText(text),
      orderIndex: 0,
      depth: 0,
      startOffset: 0,
      endOffset: text.length,
      suggestedClauseType: "LIABILITY",
    },
  ]);
  return clauseId;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Clause Standards Test Org A", slug: `clause-standards-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Clause Standards Test Org B", slug: `clause-standards-test-b-${Date.now()}` },
  });

  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
    },
  });
  memberA = await prisma.user.create({
    data: {
      name: "Member A",
      email: `member-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.MEMBER } },
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
  await prisma.clauseStandard.deleteMany({ where: { id: { in: createdStandardIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, ownerB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("ClauseStandard CRUD", () => {
  it("allows OWNER to create a standard", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "표준 조항", clauseType: "LIABILITY", text: "표준 본문 내용입니다." },
    });
    createdStandardIds.push(standard.id);
    expect(standard.id).toBeTruthy();
  });

  it("blocks MEMBER from creating a standard", async () => {
    await expect(
      createClauseStandard({
        userId: memberA.id,
        organizationId: orgA.id,
        input: { name: "차단 테스트", clauseType: "LIABILITY", text: "본문" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows OWNER to update a standard", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "수정 전", clauseType: "TERM", text: "수정 전 본문" },
    });
    createdStandardIds.push(standard.id);

    const updated = await updateClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      standardId: standard.id,
      input: { name: "수정 후", clauseType: "TERM", text: "수정 후 본문" },
    });
    expect(updated.name).toBe("수정 후");
  });

  it("blocks MEMBER from updating a standard", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "수정 차단 테스트", clauseType: "TERM", text: "본문" },
    });
    createdStandardIds.push(standard.id);

    await expect(
      updateClauseStandard({
        userId: memberA.id,
        organizationId: orgA.id,
        standardId: standard.id,
        input: { name: "무단 수정", clauseType: "TERM", text: "본문" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows OWNER to soft-delete a standard", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "삭제 테스트", clauseType: "TERM", text: "본문" },
    });
    createdStandardIds.push(standard.id);

    await deleteClauseStandard({ userId: ownerA.id, organizationId: orgA.id, standardId: standard.id });

    await expect(
      getClauseStandard({ userId: ownerA.id, organizationId: orgA.id, standardId: standard.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("blocks a different organization from reading a standard", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "교차조직 테스트", clauseType: "TERM", text: "본문" },
    });
    createdStandardIds.push(standard.id);

    await expect(
      getClauseStandard({ userId: ownerB.id, organizationId: orgB.id, standardId: standard.id })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listClauseStandardsByType returns only active standards of the requested type", async () => {
    const active = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "활성 표준", clauseType: "CONFIDENTIALITY", text: "본문" },
    });
    createdStandardIds.push(active.id);
    const inactive = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "비활성 표준", clauseType: "CONFIDENTIALITY", text: "본문", isActive: false },
    });
    createdStandardIds.push(inactive.id);

    const results = await listClauseStandardsByType({
      userId: ownerA.id,
      organizationId: orgA.id,
      clauseType: "CONFIDENTIALITY",
    });
    expect(results.map((r) => r.id)).toContain(active.id);
    expect(results.map((r) => r.id)).not.toContain(inactive.id);
  });

  it("never includes the standard's full text in AuditLog metadata", async () => {
    const secretText = "극비 표준 조항 본문 마커";
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "감사로그 테스트", clauseType: "TERM", text: secretText },
    });
    createdStandardIds.push(standard.id);

    const logs = await prisma.auditLog.findMany({ where: { entityId: standard.id } });
    for (const log of logs) {
      expect(JSON.stringify(log.metadata)).not.toContain(secretText);
    }
  });
});

describe("compareClauseToStandard", () => {
  it("detects a numeric difference and never mutates the contract", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "비교-숫자차이 테스트");
    const clauseId = await seedClause(orgA.id, contract.id, "해지 통보는 30일 전에 하여야 한다.", ownerA.id);
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "해지 통보 표준", clauseType: "TERMINATION", text: "해지 통보는 60일 전에 하여야 한다." },
    });
    createdStandardIds.push(standard.id);

    const before = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });

    const comparison = await compareClauseToStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      clauseId,
      standardId: standard.id,
    });
    expect(comparison.numberDifference.onlyInClause).toContain("30");
    expect(comparison.numberDifference.onlyInStandard).toContain("60");

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.title).toBe(before.title);
  });

  it("detects a date difference", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "비교-날짜차이 테스트");
    const clauseId = await seedClause(orgA.id, contract.id, "2026-08-01부터 계약이 시작된다.", ownerA.id);
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "시작일 표준", clauseType: "LIABILITY", text: "2027-01-01부터 계약이 시작된다." },
    });
    createdStandardIds.push(standard.id);

    const comparison = await compareClauseToStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      clauseId,
      standardId: standard.id,
    });
    expect(comparison.dateDifference.onlyInClause.length).toBeGreaterThan(0);
    expect(comparison.dateDifference.onlyInStandard.length).toBeGreaterThan(0);
  });

  it("detects an amount difference", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "비교-금액차이 테스트");
    const clauseId = await seedClause(orgA.id, contract.id, "위약금은 1,000,000원으로 한다.", ownerA.id);
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "위약금 표준", clauseType: "LIABILITY", text: "위약금은 5,000,000원으로 한다." },
    });
    createdStandardIds.push(standard.id);

    const comparison = await compareClauseToStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      clauseId,
      standardId: standard.id,
    });
    expect(comparison.amountDifference.onlyInClause.length).toBeGreaterThan(0);
    expect(comparison.amountDifference.onlyInStandard.length).toBeGreaterThan(0);
  });

  it("records a CLAUSE_COMPARISON_VIEWED audit log without the compared text", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "비교-감사로그 테스트");
    const secretMarker = "극비 비교 문구 마커";
    const clauseId = await seedClause(orgA.id, contract.id, secretMarker, ownerA.id);
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "감사로그 비교 표준", clauseType: "LIABILITY", text: "표준 본문" },
    });
    createdStandardIds.push(standard.id);

    await compareClauseToStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      clauseId,
      standardId: standard.id,
    });

    const logs = await prisma.auditLog.findMany({
      where: { entityId: clauseId, action: "CLAUSE_COMPARISON_VIEWED" },
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(JSON.stringify(log.metadata)).not.toContain(secretMarker);
    }
  });

  it("blocks comparing against a standard from another organization", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "교차조직 비교 테스트");
    const clauseId = await seedClause(orgA.id, contract.id, "본문", ownerA.id);
    const standardB = await createClauseStandard({
      userId: ownerB.id,
      organizationId: orgB.id,
      input: { name: "다른 조직 표준", clauseType: "LIABILITY", text: "본문" },
    });
    createdStandardIds.push(standardB.id);

    await expect(
      compareClauseToStandard({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        clauseId,
        standardId: standardB.id,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
