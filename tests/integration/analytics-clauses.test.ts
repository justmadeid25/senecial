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

const TEST_EMAIL_DOMAIN = "analytics-clauses-test.local";

let orgA: { id: string };
let orgB: { id: string };
let ownerA: { id: string };
let ownerB: { id: string };

const createdContractIds: string[] = [];
const createdDocumentIds: string[] = [];

async function createTestContract(userId: string, organizationId: string, title: string) {
  const created = await createContract({
    userId,
    organizationId,
    input: { title, contractType: "LEASE", status: "ACTIVE", autoRenewal: false, currency: "KRW" },
  });
  createdContractIds.push(created.id);
  return created;
}

/** Same direct-insert pattern as clause-review-signals.test.ts, kept out of the queue project. */
async function seedSegmentationJobWithClauses(
  organizationId: string,
  contractId: string,
  createdById: string,
  clauses: Array<{ text: string; suggestedClauseType: string; reviewedClauseType?: string | null; classificationState?: string }>,
  options: { createdAtOffsetMs?: number; documentId?: string } = {}
) {
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
  const text = clauses.map((c) => c.text).join("\n");
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
  const createdAt = options.createdAtOffsetMs
    ? new Date(Date.now() + options.createdAtOffsetMs)
    : new Date();
  await prisma.clauseSegmentationJob.update({
    where: { id: segmentationJob.id },
    data: { status: ClauseSegmentationJobStatus.REVIEW_REQUIRED, completedAt: createdAt, createdAt },
  });

  let cursor = 0;
  const rows = clauses.map((clause, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + clause.text.length;
    cursor = endOffset + 1;
    return {
      id: randomUUID(),
      organizationId,
      contractId,
      extractedDocumentId: document.id,
      segmentationJobId: segmentationJob.id,
      clauseNumber: `제${index + 1}조`,
      text: clause.text,
      normalizedText: normalizeClauseText(clause.text),
      orderIndex: index,
      depth: 0,
      startOffset,
      endOffset,
      suggestedClauseType: clause.suggestedClauseType as never,
      reviewedClauseType: (clause.reviewedClauseType ?? null) as never,
      classificationState: (clause.classificationState ?? "UNREVIEWED") as never,
    };
  });
  await createContractClauses(rows);
  return { segmentationJobId: segmentationJob.id, documentId: document.id, clauseIds: rows.map((r) => r.id) };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Analytics Clauses Test Org A", slug: `analytics-clauses-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Analytics Clauses Test Org B", slug: `analytics-clauses-test-b-${Date.now()}` },
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
  await prisma.clauseStandard.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contractClause.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.clauseSegmentationJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractExtractedDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.contractExtractionJob.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contractFile.deleteMany({ where: { contractId: { in: createdContractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("getClauseTypeAnalytics (§41 - latest revision only)", () => {
  it("counts clauses from the latest segmentation job, excluding a superseded revision of the same document", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "리비전 집계 테스트");

    const file = await prisma.contractFile.create({
      data: {
        organizationId: orgA.id,
        contractId: contract.id,
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
        contractId: contract.id,
        contractFileId: file.id,
        extractorVersion: "seed-v1",
        inputChecksum: randomUUID(),
        createdById: ownerA.id,
      },
    });
    const text = "제1조 옛 버전 조항입니다.";
    const document = await prisma.contractExtractedDocument.create({
      data: {
        extractionJobId: extractionJob.id,
        organizationId: orgA.id,
        contractId: contract.id,
        contractFileId: file.id,
        text,
        characterCount: text.length,
        extractionMethod: "seed",
        contentChecksum: randomUUID(),
      },
    });
    createdDocumentIds.push(document.id);

    const oldJob = await createSegmentationJobRow({
      organizationId: orgA.id,
      contractId: contract.id,
      extractedDocumentId: document.id,
      segmenterVersion: CLAUSE_SEGMENTER_VERSION,
      inputChecksum: document.contentChecksum,
      jobKey: randomUUID(),
      createdById: ownerA.id,
    });
    await prisma.clauseSegmentationJob.update({
      where: { id: oldJob.id },
      data: {
        status: ClauseSegmentationJobStatus.REVIEW_REQUIRED,
        completedAt: new Date(Date.now() - 60_000),
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await createContractClauses([
      {
        id: randomUUID(),
        organizationId: orgA.id,
        contractId: contract.id,
        extractedDocumentId: document.id,
        segmentationJobId: oldJob.id,
        clauseNumber: "제1조",
        text,
        normalizedText: normalizeClauseText(text),
        orderIndex: 0,
        depth: 0,
        startOffset: 0,
        endOffset: text.length,
        suggestedClauseType: "WARRANTY",
      },
    ]);

    const newText = "제1조 새 버전 조항입니다.";
    const newJob = await createSegmentationJobRow({
      organizationId: orgA.id,
      contractId: contract.id,
      extractedDocumentId: document.id,
      segmenterVersion: CLAUSE_SEGMENTER_VERSION,
      inputChecksum: `${document.contentChecksum}-v2`,
      jobKey: randomUUID(),
      createdById: ownerA.id,
    });
    await prisma.clauseSegmentationJob.update({
      where: { id: newJob.id },
      data: { status: ClauseSegmentationJobStatus.REVIEW_REQUIRED, completedAt: new Date() },
    });
    await createContractClauses([
      {
        id: randomUUID(),
        organizationId: orgA.id,
        contractId: contract.id,
        extractedDocumentId: document.id,
        segmentationJobId: newJob.id,
        clauseNumber: "제1조",
        text: newText,
        normalizedText: normalizeClauseText(newText),
        orderIndex: 0,
        depth: 0,
        startOffset: 0,
        endOffset: newText.length,
        suggestedClauseType: "INDEMNITY",
      },
    ]);

    const analytics = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const warranty = analytics.rows.find((r) => r.clauseType === "WARRANTY");
    const indemnity = analytics.rows.find((r) => r.clauseType === "INDEMNITY");
    expect(warranty).toBeUndefined();
    expect(indemnity?.clauseCount).toBeGreaterThanOrEqual(1);
  });

  it("counts clauses per ClauseType", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "유형별 집계 테스트");
    await seedSegmentationJobWithClauses(orgA.id, contract.id, ownerA.id, [
      { text: "제1조 비밀유지 조항입니다.", suggestedClauseType: "CONFIDENTIALITY" },
      { text: "제2조 손해배상 조항입니다.", suggestedClauseType: "LIABILITY" },
    ]);

    const analytics = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(analytics.rows.find((r) => r.clauseType === "CONFIDENTIALITY")?.clauseCount).toBeGreaterThanOrEqual(1);
    expect(analytics.rows.find((r) => r.clauseType === "LIABILITY")?.clauseCount).toBeGreaterThanOrEqual(1);
  });

  it("counts DISTINCT contracts per clause type, not raw clause rows", async () => {
    const contract1 = await createTestContract(ownerA.id, orgA.id, "동일유형 계약 1");
    const contract2 = await createTestContract(ownerA.id, orgA.id, "동일유형 계약 2");
    await seedSegmentationJobWithClauses(orgA.id, contract1.id, ownerA.id, [
      { text: "제1조 보증 조항 A입니다.", suggestedClauseType: "WARRANTY" },
      { text: "제2조 보증 조항 B입니다.", suggestedClauseType: "WARRANTY" },
    ]);
    await seedSegmentationJobWithClauses(orgA.id, contract2.id, ownerA.id, [
      { text: "제1조 보증 조항 C입니다.", suggestedClauseType: "WARRANTY" },
    ]);

    const analytics = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    const warranty = analytics.rows.find((r) => r.clauseType === "WARRANTY");
    expect(warranty?.clauseCount).toBeGreaterThanOrEqual(3);
    expect(warranty?.contractCount).toBeGreaterThanOrEqual(2);
  });

  it("counts UNREVIEWED / CONFIRMED / CORRECTED / REJECTED classification states", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "분류상태 집계 테스트");
    await seedSegmentationJobWithClauses(orgA.id, contract.id, ownerA.id, [
      { text: "제1조 미검토 조항입니다.", suggestedClauseType: "OTHER", classificationState: "UNREVIEWED" },
      {
        text: "제2조 승인된 조항입니다.",
        suggestedClauseType: "TERM",
        reviewedClauseType: "TERM",
        classificationState: "CONFIRMED",
      },
      {
        text: "제3조 수정된 조항입니다.",
        suggestedClauseType: "OTHER",
        reviewedClauseType: "PAYMENT",
        classificationState: "CORRECTED",
      },
      {
        text: "제4조 거절된 조항입니다.",
        suggestedClauseType: "SECURITY",
        classificationState: "REJECTED",
      },
    ]);

    const analytics = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(analytics.classificationStateCounts.UNREVIEWED).toBeGreaterThanOrEqual(1);
    expect(analytics.classificationStateCounts.CONFIRMED).toBeGreaterThanOrEqual(1);
    expect(analytics.classificationStateCounts.CORRECTED).toBeGreaterThanOrEqual(1);
    expect(analytics.classificationStateCounts.REJECTED).toBeGreaterThanOrEqual(1);
  });

  it("marks hasActiveStandard true only when an active standard of that type exists", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "기준조항 유무 테스트");
    await seedSegmentationJobWithClauses(orgA.id, contract.id, ownerA.id, [
      { text: "제1조 감사권 조항입니다.", suggestedClauseType: "AUDIT_RIGHTS" },
    ]);

    const before = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(before.rows.find((r) => r.clauseType === "AUDIT_RIGHTS")?.hasActiveStandard).toBe(false);

    await prisma.clauseStandard.create({
      data: {
        organizationId: orgA.id,
        name: "감사권 기준",
        clauseType: "AUDIT_RIGHTS",
        text: "표준 본문",
        normalizedText: normalizeClauseText("표준 본문"),
        createdById: ownerA.id,
        isActive: true,
      },
    });

    const after = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.rows.find((r) => r.clauseType === "AUDIT_RIGHTS")?.hasActiveStandard).toBe(true);
  });

  it("never leaks another organization's clauses", async () => {
    const contractB = await createTestContract(ownerB.id, orgB.id, "다른 조직 조항 테스트");
    await seedSegmentationJobWithClauses(orgB.id, contractB.id, ownerB.id, [
      { text: "제1조 다른조직 준거법 조항입니다.", suggestedClauseType: "GOVERNING_LAW" },
    ]);

    const analyticsA = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(analyticsA.rows.find((r) => r.clauseType === "GOVERNING_LAW")).toBeUndefined();
  });

  it("excludes clauses belonging to a soft-deleted contract entirely", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "삭제될 계약의 조항");
    await seedSegmentationJobWithClauses(orgA.id, contract.id, ownerA.id, [
      { text: "제1조 하도급 조항입니다.", suggestedClauseType: "SUBCONTRACTING" },
    ]);

    const before = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(before.rows.find((r) => r.clauseType === "SUBCONTRACTING")?.clauseCount).toBeGreaterThanOrEqual(1);

    await prisma.contract.update({ where: { id: contract.id }, data: { deletedAt: new Date() } });

    const after = await getClauseTypeAnalytics({ userId: ownerA.id, organizationId: orgA.id });
    expect(after.rows.find((r) => r.clauseType === "SUBCONTRACTING")).toBeUndefined();
  });
});
