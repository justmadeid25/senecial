import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClauseSegmentationJobStatus, MembershipRole } from "@/generated/prisma/enums";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseStandard } from "@/features/clauses/server/create-clause-standard";
import { generateClauseReviewSignals } from "@/features/clauses/server/generate-clause-review-signals";
import { listClauseReviewSignals } from "@/features/clauses/server/list-clause-review-signals";
import { updateClauseReviewSignal } from "@/features/clauses/server/update-clause-review-signal";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { MAX_REVIEW_NOTE_LENGTH } from "@/lib/validation/clauses";
import { createClauseSegmentationJob as createSegmentationJobRow } from "@/server/repositories/clause-segmentation-job-repository";
import { createContractClauses } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";

const TEST_EMAIL_DOMAIN = "clause-review-signals-test.local";

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

/** Same direct-insert helper as clause-search.test.ts / clause-standards-and-comparison.test.ts - stays out of the queue. */
async function seedClause(
  organizationId: string,
  contractId: string,
  text: string,
  createdById: string,
  suggestedClauseType: string = "LIABILITY"
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
      suggestedClauseType: suggestedClauseType as never,
    },
  ]);
  return clauseId;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });

  orgA = await prisma.organization.create({
    data: { name: "Clause Review Signals Test Org A", slug: `clause-review-signals-test-a-${Date.now()}` },
  });
  orgB = await prisma.organization.create({
    data: { name: "Clause Review Signals Test Org B", slug: `clause-review-signals-test-b-${Date.now()}` },
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
  await prisma.clauseReviewSignal.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
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

describe("generateClauseReviewSignals", () => {
  it("creates an AUTO_RENEWAL_PRESENT signal from matching clause text", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "자동갱신 신호 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 별도 통보가 없는 경우 자동갱신 됩니다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    const autoRenewal = signals.find((s) => s.signalType === "AUTO_RENEWAL_PRESENT");
    expect(autoRenewal).toBeTruthy();
    expect(autoRenewal?.status).toBe("OPEN");
    expect(autoRenewal?.evidenceText).toBeTruthy();
    expect(autoRenewal?.evidenceText!.length).toBeLessThanOrEqual(500);
  });

  it("creates an UNLIMITED_LIABILITY_LANGUAGE signal from matching clause text", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "무제한 배상 신호 테스트");
    await seedClause(orgA.id, contract.id, "을은 갑에게 발생한 모든 손해를 배상하여야 한다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    expect(signals.some((s) => s.signalType === "UNLIMITED_LIABILITY_LANGUAGE")).toBe(true);
  });

  it("creates a ONE_SIDED_TERMINATION_LANGUAGE signal from matching clause text", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "일방 해지 신호 테스트");
    await seedClause(orgA.id, contract.id, "갑은 언제든지 통보 없이 해지할 수 있다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    expect(signals.some((s) => s.signalType === "ONE_SIDED_TERMINATION_LANGUAGE")).toBe(true);
  });

  it("creates no signal for a clause with none of the keyword patterns", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "무신호 테스트");
    await seedClause(orgA.id, contract.id, "본 계약의 목적은 물품 공급에 관한 사항을 정함에 있다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    expect(signals.length).toBe(0);
  });

  it("creates a MISSING_EXPECTED_CLAUSE signal when an active standard's type is absent from the contract", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: { name: "개발용 내부 참고 조항 - 비밀유지", clauseType: "CONFIDENTIALITY", text: "표준 본문" },
    });
    createdStandardIds.push(standard.id);

    const contract = await createTestContract(ownerA.id, orgA.id, "누락 조항 신호 테스트");
    await seedClause(orgA.id, contract.id, "본 계약의 목적은 물품 공급에 관한 사항을 정함에 있다.", ownerA.id, "TERM");

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    const missing = signals.find((s) => s.signalType === "MISSING_EXPECTED_CLAUSE");
    expect(missing).toBeTruthy();
    expect(missing?.clauseType).toBe("CONFIDENTIALITY");
    expect(missing?.contractClauseId).toBeNull();
  });

  it("does not create a MISSING_EXPECTED_CLAUSE signal when an inactive standard's type is absent", async () => {
    const standard = await createClauseStandard({
      userId: ownerA.id,
      organizationId: orgA.id,
      input: {
        name: "개발용 내부 참고 조항 - 비활성",
        clauseType: "GOVERNING_LAW",
        text: "표준 본문",
        isActive: false,
      },
    });
    createdStandardIds.push(standard.id);

    const contract = await createTestContract(ownerA.id, orgA.id, "비활성기준 무시 테스트");
    await seedClause(orgA.id, contract.id, "본 계약의 목적은 물품 공급에 관한 사항을 정함에 있다.", ownerA.id, "TERM");

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    expect(
      signals.some((s) => s.signalType === "MISSING_EXPECTED_CLAUSE" && s.clauseType === "GOVERNING_LAW")
    ).toBe(false);
  });

  it("is idempotent: regenerating does not create duplicate signals (signalKey dedup)", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "재생성 중복방지 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);

    const first = await generateClauseReviewSignals({ organizationId: orgA.id });
    const second = await generateClauseReviewSignals({ organizationId: orgA.id });

    expect(first.signalsCreated).toBeGreaterThan(0);
    expect(second.signalsCreated).toBe(0);

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    const autoRenewalSignals = signals.filter((s) => s.signalType === "AUTO_RENEWAL_PRESENT");
    expect(autoRenewalSignals.length).toBe(1);
  });

  it("only scans the latest segmentation job per document, ignoring superseded revisions", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "리비전 신호 테스트");

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
    const text = "갑은 언제든지 통보 없이 해지할 수 있다.";
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

    // First (superseded) revision - has the keyword.
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
        suggestedClauseType: "TERMINATION",
      },
    ]);

    // Second (latest) revision of the SAME document - no longer has the keyword.
    const newText = "본 계약의 목적은 물품 공급에 관한 사항을 정함에 있다.";
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
        suggestedClauseType: "TERM",
      },
    ]);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const signals = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    expect(signals.some((s) => s.signalType === "ONE_SIDED_TERMINATION_LANGUAGE")).toBe(false);
  });

  it("writes a CLAUSE_REVIEW_SIGNALS_GENERATED audit log only when signals are created, without evidence text", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "감사로그 생성 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const logs = await prisma.auditLog.findMany({
      where: { entityId: contract.id, action: "CLAUSE_REVIEW_SIGNALS_GENERATED" },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.metadata).toMatchObject({ contractId: contract.id });
    expect(JSON.stringify(logs[0]!.metadata)).not.toContain("자동갱신 됩니다");

    // Regenerating with nothing new to create must not write another log entry.
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const logsAfter = await prisma.auditLog.findMany({
      where: { entityId: contract.id, action: "CLAUSE_REVIEW_SIGNALS_GENERATED" },
    });
    expect(logsAfter.length).toBe(1);
  });

  it("never leaks signals across organizations", async () => {
    const contractB = await createTestContract(ownerB.id, orgB.id, "교차조직 신호 테스트");
    await seedClause(orgB.id, contractB.id, "본 계약은 자동갱신 됩니다.", ownerB.id);

    await generateClauseReviewSignals({ organizationId: orgB.id });

    // ownerA is a member of orgA (so membership passes), but scoping by orgA.id
    // must never surface orgB's contract/signals - it returns empty, not a leak.
    const results = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contractB.id,
    });
    expect(results).toEqual([]);

    // A user with no membership in orgB at all must be rejected outright.
    await expect(
      listClauseReviewSignals({ userId: ownerA.id, organizationId: orgB.id, contractId: contractB.id })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("listClauseReviewSignals filters", () => {
  it("filters by signalType", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "필터-유형 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다. 갑은 언제든지 통보 없이 해지할 수 있다.", ownerA.id);

    await generateClauseReviewSignals({ organizationId: orgA.id });

    const filtered = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalType: "AUTO_RENEWAL_PRESENT",
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.signalType === "AUTO_RENEWAL_PRESENT")).toBe(true);
  });

  it("filters by status", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "필터-상태 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });

    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    await updateClauseReviewSignal({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalId: signal!.id,
      input: { action: "DISMISS" },
    });

    const openOnly = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      status: "OPEN",
    });
    expect(openOnly.some((s) => s.id === signal!.id)).toBe(false);

    const dismissedOnly = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      status: "DISMISSED",
    });
    expect(dismissedOnly.some((s) => s.id === signal!.id)).toBe(true);
  });
});

describe("updateClauseReviewSignal", () => {
  it("transitions OPEN -> ACKNOWLEDGED and records reviewedById/reviewedAt", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "확인 처리 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });

    await updateClauseReviewSignal({
      userId: memberA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalId: signal!.id,
      input: { action: "ACKNOWLEDGE" },
    });

    const updated = await prisma.clauseReviewSignal.findUniqueOrThrow({ where: { id: signal!.id } });
    expect(updated.status).toBe("ACKNOWLEDGED");
    expect(updated.reviewedById).toBe(memberA.id);
    expect(updated.reviewedAt).not.toBeNull();
  });

  it("transitions OPEN -> RESOLVED with a reviewNote", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "조치완료 처리 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });

    await updateClauseReviewSignal({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalId: signal!.id,
      input: { action: "RESOLVE", reviewNote: "담당자 확인 후 계약서 수정 요청함." },
    });

    const updated = await prisma.clauseReviewSignal.findUniqueOrThrow({ where: { id: signal!.id } });
    expect(updated.status).toBe("RESOLVED");
    expect(updated.reviewNote).toBe("담당자 확인 후 계약서 수정 요청함.");
  });

  it("never overwrites the original signalType or evidenceText", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "원본보존 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    const originalSignalType = signal!.signalType;
    const originalEvidenceText = signal!.evidenceText;

    await updateClauseReviewSignal({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalId: signal!.id,
      input: { action: "DISMISS", reviewNote: "검토 대상 아님" },
    });

    const updated = await prisma.clauseReviewSignal.findUniqueOrThrow({ where: { id: signal!.id } });
    expect(updated.signalType).toBe(originalSignalType);
    expect(updated.evidenceText).toBe(originalEvidenceText);
  });

  it("rejects a reviewNote longer than the configured maximum", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "메모길이제한 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });

    await expect(
      updateClauseReviewSignal({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        signalId: signal!.id,
        input: { action: "DISMISS", reviewNote: "가".repeat(MAX_REVIEW_NOTE_LENGTH + 1) },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks updating a signal that belongs to a different organization's contract", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "교차조직 처리 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });

    await expect(
      updateClauseReviewSignal({
        userId: ownerB.id,
        organizationId: orgB.id,
        contractId: contract.id,
        signalId: signal!.id,
        input: { action: "ACKNOWLEDGE" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("raises NotFoundError for a non-existent signal id", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "존재하지않는신호 테스트");

    await expect(
      updateClauseReviewSignal({
        userId: ownerA.id,
        organizationId: orgA.id,
        contractId: contract.id,
        signalId: randomUUID(),
        input: { action: "ACKNOWLEDGE" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("writes a CLAUSE_REVIEW_SIGNAL_UPDATED audit log that excludes the reviewNote content", async () => {
    const contract = await createTestContract(ownerA.id, orgA.id, "감사로그 처리 테스트");
    await seedClause(orgA.id, contract.id, "본 계약은 자동갱신 됩니다.", ownerA.id);
    await generateClauseReviewSignals({ organizationId: orgA.id });
    const [signal] = await listClauseReviewSignals({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
    });
    const secretNote = "극비 검토 메모 마커";

    await updateClauseReviewSignal({
      userId: ownerA.id,
      organizationId: orgA.id,
      contractId: contract.id,
      signalId: signal!.id,
      input: { action: "DISMISS", reviewNote: secretNote },
    });

    const logs = await prisma.auditLog.findMany({
      where: { entityId: signal!.id, action: "CLAUSE_REVIEW_SIGNAL_UPDATED" },
    });
    expect(logs.length).toBe(1);
    expect(JSON.stringify(logs[0]!.metadata)).not.toContain(secretNote);
    expect(logs[0]!.metadata).toMatchObject({ contractId: contract.id, signalId: signal!.id, status: "DISMISSED" });
  });
});
