import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus, MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { createContract } from "@/features/contracts/server/create-contract";
import { getClauseTypeAnalytics } from "@/features/analytics/server/get-clause-type-analytics";
import { createClauseSegmentationJob as createSegmentationJobRow } from "@/server/repositories/clause-segmentation-job-repository";
import { createContractClauses } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "analytics-clause-filter-test.local";

let orgA: { id: string };
let ownerA: { id: string };

const createdContractIds: string[] = [];
const createdDocumentIds: string[] = [];

async function createTestContract(title: string, overrides: Record<string, unknown> = {}) {
  const created = await createContract({
    userId: ownerA.id,
    organizationId: orgA.id,
    input: { title, contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW", ...overrides },
  });
  createdContractIds.push(created.id);
  return created;
}

async function seedClause(contractId: string, text: string, suggestedClauseType = "LIABILITY") {
  const file = await prisma.contractFile.create({
    data: {
      organizationId: orgA.id,
      contractId,
      uploadedById: ownerA.id,
      originalName: "seed.docx",
      storageKey: `seed/${randomUUID()}`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      checksum: randomUUID(),
    },
  });
  const extractionJob = await prisma.contractExtractionJob.create({
    data: {
      organizationId: orgA.id,
      contractId,
      contractFileId: file.id,
      extractorVersion: "seed-v1",
      inputChecksum: randomUUID(),
      createdById: ownerA.id,
    },
  });
  const document = await prisma.contractExtractedDocument.create({
    data: {
      extractionJobId: extractionJob.id,
      organizationId: orgA.id,
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
    organizationId: orgA.id,
    contractId,
    extractedDocumentId: document.id,
    segmenterVersion: CLAUSE_SEGMENTER_VERSION,
    inputChecksum: document.contentChecksum,
    jobKey: randomUUID(),
    createdById: ownerA.id,
  });
  await prisma.clauseSegmentationJob.update({
    where: { id: segmentationJob.id },
    data: { status: ClauseSegmentationJobStatus.REVIEW_REQUIRED, completedAt: new Date() },
  });

  await createContractClauses([
    {
      id: randomUUID(),
      organizationId: orgA.id,
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
      suggestedClauseType: suggestedClauseType as never,
    },
  ]);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Clause Filter Test Org", slug: `analytics-clause-filter-test-${Date.now()}` },
  });
  ownerA = await prisma.user.create({
    data: {
      name: "Owner A",
      email: `owner-a@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: orgA.id, role: MembershipRole.OWNER } },
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
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: orgA.id } });
});

describe("contract-level filters propagate into getClauseTypeAnalytics (§5/§11)", () => {
  it("contractType filter excludes clauses from a non-matching contract", async () => {
    const matching = await createTestContract("계약유형 전파 매치", { contractType: "SERVICE" });
    const nonMatching = await createTestContract("계약유형 전파 불일치", { contractType: "LEASE" });
    await seedClause(matching.id, "제1조 감사권 전파 테스트 A입니다.", "AUDIT_RIGHTS");
    await seedClause(nonMatching.id, "제1조 감사권 전파 테스트 B입니다.", "AUDIT_RIGHTS");

    const filtered = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { contractType: "SERVICE" },
    });
    const row = filtered.rows.find((r) => r.clauseType === "AUDIT_RIGHTS");
    expect(row?.clauseCount).toBe(1);
  });

  it("displayStatus filter excludes clauses from a non-matching-status contract", async () => {
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 10);
    const expired = await createTestContract("상태전파 만료계약", { endDate: past.toISOString().slice(0, 10) });
    await seedClause(expired.id, "제1조 컴플라이언스 전파 테스트입니다.", "COMPLIANCE");

    const filteredActive = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { displayStatus: "ACTIVE" },
    });
    expect(filteredActive.rows.find((r) => r.clauseType === "COMPLIANCE")).toBeUndefined();

    const filteredExpired = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { displayStatus: "EXPIRED" },
    });
    expect(filteredExpired.rows.find((r) => r.clauseType === "COMPLIANCE")?.clauseCount).toBe(1);
  });

  it("counterparty filter excludes clauses from contracts linked to a different counterparty", async () => {
    const noCounterparty = await createTestContract("상대방전파 미연결");
    await seedClause(noCounterparty.id, "제1조 보험 전파 테스트입니다.", "INSURANCE");

    const filtered = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { counterpartyId: "non-existent-counterparty-id" },
    });
    expect(filtered.rows.find((r) => r.clauseType === "INSURANCE")).toBeUndefined();
  });

  it("currency filter excludes clauses from a contract in a different currency", async () => {
    const usdContract = await createTestContract("통화전파 USD", { currency: "USD", amount: "100" });
    await seedClause(usdContract.id, "제1조 하도급 전파 테스트입니다.", "SUBCONTRACTING");

    const filteredKrw = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { currency: "KRW" },
    });
    expect(filteredKrw.rows.find((r) => r.clauseType === "SUBCONTRACTING")).toBeUndefined();

    const filteredUsd = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { currency: "USD" },
    });
    expect(filteredUsd.rows.find((r) => r.clauseType === "SUBCONTRACTING")?.clauseCount).toBe(1);
  });

  it("autoRenewal filter excludes clauses from a non-matching contract", async () => {
    const autoRenewalContract = await createTestContract("자동갱신전파 O", { autoRenewal: true });
    await seedClause(autoRenewalContract.id, "제1조 양도 전파 테스트입니다.", "ASSIGNMENT");

    const filteredFalse = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { autoRenewal: false },
    });
    expect(filteredFalse.rows.find((r) => r.clauseType === "ASSIGNMENT")).toBeUndefined();

    const filteredTrue = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { autoRenewal: true },
    });
    expect(filteredTrue.rows.find((r) => r.clauseType === "ASSIGNMENT")?.clauseCount).toBe(1);
  });

  it("clauseType filter narrows the type breakdown AND the classification-state counts to that type", async () => {
    const contract = await createTestContract("조항유형필터 계약");
    await seedClause(contract.id, "제1조 변경 관리 필터 테스트입니다.", "CHANGE_CONTROL");

    const filtered = await getClauseTypeAnalytics({
      userId: ownerA.id,
      organizationId: orgA.id,
      filters: { clauseType: "CHANGE_CONTROL" },
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]!.clauseType).toBe("CHANGE_CONTROL");
    const totalClassified = Object.values(filtered.classificationStateCounts).reduce((a, b) => a + b, 0);
    expect(totalClassified).toBe(filtered.rows[0]!.clauseCount);
  });
});
